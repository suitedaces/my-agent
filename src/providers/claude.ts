import { query } from '@anthropic-ai/claude-agent-sdk';
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import type { Provider, ProviderRunOptions, ProviderMessage, ProviderAuthStatus, ProviderQueryResult, RunHandle } from './types.js';

// ── File paths ──────────────────────────────────────────────────────
const DORABOT_DIR = join(homedir(), '.dorabot');
const KEY_FILE = join(DORABOT_DIR, '.anthropic-key');
const OAUTH_FILE = join(DORABOT_DIR, '.claude-oauth.json');

// ── OAuth constants (same as Claude Code CLI) ───────────────────────
const OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const OAUTH_AUTHORIZE_URL = 'https://claude.ai/oauth/authorize';
const OAUTH_TOKEN_URL = 'https://console.anthropic.com/v1/oauth/token';
const OAUTH_REDIRECT_URI = 'https://console.anthropic.com/oauth/code/callback';
const OAUTH_SCOPES = 'user:inference user:profile';

// ── API key helpers ─────────────────────────────────────────────────
function loadPersistedKey(): string | undefined {
  try {
    if (existsSync(KEY_FILE)) {
      const key = readFileSync(KEY_FILE, 'utf-8').trim();
      if (key) return key;
    }
  } catch { /* ignore */ }
  return undefined;
}

function persistKey(apiKey: string): void {
  try {
    mkdirSync(DORABOT_DIR, { recursive: true });
    writeFileSync(KEY_FILE, apiKey, { mode: 0o600 });
    chmodSync(KEY_FILE, 0o600);
  } catch (err) {
    console.error('[claude] failed to persist API key:', err);
  }
}

function clearPersistedKey(): void {
  try {
    if (existsSync(KEY_FILE)) writeFileSync(KEY_FILE, '', { mode: 0o600 });
  } catch { /* ignore */ }
}

function getApiKey(): string | undefined {
  return process.env.ANTHROPIC_API_KEY || loadPersistedKey();
}

async function validateApiKey(apiKey: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const res = await fetch('https://api.anthropic.com/v1/models', {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
    });
    if (res.status === 200) return { valid: true };
    if (res.status === 401) return { valid: false, error: 'Invalid API key' };
    if (res.status === 403) return { valid: false, error: 'API key lacks permissions' };
    return { valid: false, error: `Unexpected status ${res.status}` };
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

// ── OAuth token persistence ─────────────────────────────────────────
type OAuthTokens = {
  access_token: string;
  refresh_token: string;
  expires_at: number; // ms since epoch
};

function loadOAuthTokens(): OAuthTokens | null {
  try {
    if (existsSync(OAUTH_FILE)) {
      return JSON.parse(readFileSync(OAUTH_FILE, 'utf-8'));
    }
  } catch { /* ignore */ }
  return null;
}

function persistOAuthTokens(tokens: OAuthTokens): void {
  try {
    mkdirSync(DORABOT_DIR, { recursive: true });
    writeFileSync(OAUTH_FILE, JSON.stringify(tokens), { mode: 0o600 });
    chmodSync(OAUTH_FILE, 0o600);
  } catch (err) {
    console.error('[claude] failed to persist OAuth tokens:', err);
  }
}

function clearOAuthTokens(): void {
  try {
    if (existsSync(OAUTH_FILE)) writeFileSync(OAUTH_FILE, '', { mode: 0o600 });
  } catch { /* ignore */ }
}

/** Refresh the access token using the refresh token */
async function refreshAccessToken(refreshToken: string): Promise<OAuthTokens | null> {
  try {
    const res = await fetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: OAUTH_CLIENT_ID,
      }),
    });
    if (!res.ok) {
      console.error(`[claude] token refresh failed: ${res.status}`);
      return null;
    }
    const data = await res.json() as { access_token: string; refresh_token?: string; expires_in?: number };
    const tokens: OAuthTokens = {
      access_token: data.access_token,
      refresh_token: data.refresh_token || refreshToken,
      expires_at: Date.now() + ((data.expires_in || 28800) * 1000), // default 8h
    };
    persistOAuthTokens(tokens);
    return tokens;
  } catch (err) {
    console.error('[claude] token refresh error:', err);
    return null;
  }
}

/** Ensure we have a valid access token, refreshing if needed. Sets CLAUDE_CODE_OAUTH_TOKEN env. */
async function ensureOAuthToken(): Promise<string | null> {
  const tokens = loadOAuthTokens();
  if (!tokens) return null;

  // If token expires in < 5 min, refresh
  if (Date.now() > tokens.expires_at - 300_000) {
    console.log('[claude] access token expired or expiring, refreshing...');
    const refreshed = await refreshAccessToken(tokens.refresh_token);
    if (!refreshed) return null;
    process.env.CLAUDE_CODE_OAUTH_TOKEN = refreshed.access_token;
    return refreshed.access_token;
  }

  process.env.CLAUDE_CODE_OAUTH_TOKEN = tokens.access_token;
  return tokens.access_token;
}

// ── PKCE helpers ────────────────────────────────────────────────────
function generateCodeVerifier(): string {
  return randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

// ── Detection helpers (exported for gateway provider.detect) ────────

/** Check if we have persisted OAuth tokens (doesn't validate them) */
export function hasOAuthTokens(): boolean {
  const tokens = loadOAuthTokens();
  return !!tokens?.access_token;
}

export async function isClaudeInstalled(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('claude', ['--version'], { timeout: 5000 }, (err) => {
      resolve(!err);
    });
  });
}

export { getApiKey };

// ── Provider ────────────────────────────────────────────────────────

export class ClaudeProvider implements Provider {
  readonly name = 'claude';
  private _cachedAuth: ProviderAuthStatus | null = null;
  // PKCE state for in-flight OAuth
  private _pkceVerifier: string | null = null;
  private _pkceState: string | null = null;
  private _pkceLoginId: string | null = null;

  constructor() {
    // Load persisted API key into env if not already set
    if (!process.env.ANTHROPIC_API_KEY) {
      const saved = loadPersistedKey();
      if (saved) process.env.ANTHROPIC_API_KEY = saved;
    }
    // Load persisted OAuth token into env
    const tokens = loadOAuthTokens();
    if (tokens?.access_token) {
      process.env.CLAUDE_CODE_OAUTH_TOKEN = tokens.access_token;
    }
  }

  async checkReady(): Promise<{ ready: boolean; reason?: string }> {
    const status = await this.getAuthStatus();
    if (!status.authenticated) {
      return { ready: false, reason: status.error || 'Not authenticated.' };
    }
    return { ready: true };
  }

  async getAuthStatus(): Promise<ProviderAuthStatus> {
    if (this._cachedAuth) return this._cachedAuth;

    // 1. Check API key
    const apiKey = getApiKey();
    if (apiKey) {
      const v = await validateApiKey(apiKey);
      if (v.valid) {
        this._cachedAuth = { authenticated: true, method: 'api_key', identity: 'Anthropic API key' };
        return this._cachedAuth;
      }
      return { authenticated: false, method: 'api_key', error: v.error };
    }

    // 2. Check persisted OAuth tokens — refresh if needed
    const token = await ensureOAuthToken();
    if (token) {
      this._cachedAuth = { authenticated: true, method: 'oauth', identity: 'Claude subscription' };
      return this._cachedAuth;
    }

    return { authenticated: false, error: 'Not authenticated. Sign in with your Claude account or provide an API key.' };
  }

  async loginWithApiKey(apiKey: string): Promise<ProviderAuthStatus> {
    const v = await validateApiKey(apiKey);
    if (!v.valid) {
      return { authenticated: false, method: 'api_key', error: v.error };
    }
    process.env.ANTHROPIC_API_KEY = apiKey;
    persistKey(apiKey);
    this._cachedAuth = { authenticated: true, method: 'api_key', identity: 'Anthropic API key' };
    return this._cachedAuth;
  }

  /**
   * Start OAuth PKCE flow. Returns the authorization URL for the user to open.
   * The user will authorize, get redirected, and paste the auth code back.
   */
  async loginWithOAuth(): Promise<{ authUrl: string; loginId: string }> {
    const loginId = `claude-oauth-${Date.now()}`;
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = randomBytes(32).toString('hex');

    this._pkceVerifier = codeVerifier;
    this._pkceState = state;
    this._pkceLoginId = loginId;

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: OAUTH_CLIENT_ID,
      redirect_uri: OAUTH_REDIRECT_URI,
      scope: OAUTH_SCOPES,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    const authUrl = `${OAUTH_AUTHORIZE_URL}?${params}`;
    return { authUrl, loginId };
  }

  /**
   * Complete OAuth by exchanging the auth code for tokens.
   * The loginId is the code#state string the user pastes from the callback page.
   */
  async completeOAuthLogin(loginId: string): Promise<ProviderAuthStatus> {
    if (!this._pkceVerifier || !this._pkceState) {
      return { authenticated: false, error: 'No pending OAuth flow. Start login first.' };
    }

    // loginId from frontend is the pasted "code#state" string
    const parts = loginId.split('#');
    const code = parts[0];
    const returnedState = parts[1];

    if (!code) {
      return { authenticated: false, error: 'Invalid auth code.' };
    }

    // Validate state if returned
    if (returnedState && returnedState !== this._pkceState) {
      console.warn('[claude] OAuth state mismatch, proceeding anyway');
    }

    try {
      const res = await fetch(OAUTH_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          code,
          state: returnedState || this._pkceState || '',
          redirect_uri: OAUTH_REDIRECT_URI,
          client_id: OAUTH_CLIENT_ID,
          code_verifier: this._pkceVerifier,
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        console.error(`[claude] token exchange failed: ${res.status} ${body}`);
        return { authenticated: false, error: `Token exchange failed (${res.status})` };
      }

      const data = await res.json() as { access_token: string; refresh_token: string; expires_in?: number };

      const tokens: OAuthTokens = {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: Date.now() + ((data.expires_in || 28800) * 1000),
      };

      persistOAuthTokens(tokens);
      process.env.CLAUDE_CODE_OAUTH_TOKEN = tokens.access_token;

      // Clear PKCE state
      this._pkceVerifier = null;
      this._pkceState = null;
      this._pkceLoginId = null;

      this._cachedAuth = { authenticated: true, method: 'oauth', identity: 'Claude subscription' };
      return this._cachedAuth;
    } catch (err) {
      return { authenticated: false, error: err instanceof Error ? err.message : 'Token exchange failed' };
    }
  }

  resetAuth(): void {
    this._cachedAuth = null;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    clearPersistedKey();
    clearOAuthTokens();
  }

  async *query(opts: ProviderRunOptions): AsyncGenerator<ProviderMessage, ProviderQueryResult, unknown> {
    // Ensure OAuth token is fresh before querying
    await ensureOAuthToken();

    // ── Async generator message feed (buffett pattern) ──────────────
    // Instead of passing a string prompt to query(), we create an async
    // generator that keeps the SDK CLI process alive for message injection.
    // SDK constraint: string prompt → isSingleUserTurn=true → closes stdin
    // after first result. AsyncIterable prompt → keeps stdin open.

    type UserMsg = {
      type: 'user';
      session_id: string;
      message: { role: 'user'; content: Array<{ type: 'text'; text: string }> };
      parent_tool_use_id: null;
    };

    const messageQueue: UserMsg[] = [];
    let waitingForMessage: ((msg: UserMsg) => void) | null = null;
    let closed = false;

    const makeUserMsg = (text: string): UserMsg => ({
      type: 'user',
      session_id: '',
      message: { role: 'user', content: [{ type: 'text', text }] },
      parent_tool_use_id: null,
    });

    // Seed the queue with the initial prompt
    messageQueue.push(makeUserMsg(opts.prompt));

    async function* messageGenerator(): AsyncGenerator<UserMsg, void, unknown> {
      while (!closed && !opts.abortController?.signal.aborted) {
        if (messageQueue.length > 0) {
          yield messageQueue.shift()!;
        } else {
          const msg = await new Promise<UserMsg>((resolve) => {
            waitingForMessage = resolve;
          });
          waitingForMessage = null;
          if (closed || opts.abortController?.signal.aborted) break;
          yield msg;
        }
      }
    }

    // Create RunHandle for the gateway to inject messages
    const handle: RunHandle = {
      get active() { return !closed; },
      inject(text: string): boolean {
        if (closed) return false;
        const msg = makeUserMsg(text);
        if (waitingForMessage) {
          waitingForMessage(msg);
        } else {
          messageQueue.push(msg);
        }
        return true;
      },
      close() {
        closed = true;
        // Unblock the generator if it's suspended in await
        if (waitingForMessage) {
          waitingForMessage(makeUserMsg(''));
        }
      },
    };

    // Notify caller that the handle is ready (before SDK query starts)
    opts.onRunReady?.(handle);

    // ── SDK query with async generator prompt ───────────────────────
    const q = query({
      prompt: messageGenerator() as any,
      options: {
        model: opts.model,
        systemPrompt: opts.systemPrompt,
        tools: { type: 'preset', preset: 'claude_code' } as any,
        agents: opts.agents as any,
        hooks: opts.hooks as any,
        mcpServers: opts.mcpServer as any,
        resume: opts.resumeId,
        permissionMode: opts.config.permissionMode as any,
        allowDangerouslySkipPermissions: opts.config.permissionMode === 'bypassPermissions',
        sandbox: opts.sandbox as any,
        cwd: opts.cwd,
        env: opts.env,
        maxTurns: opts.maxTurns,
        includePartialMessages: true,
        canUseTool: opts.canUseTool as any,
        abortController: opts.abortController,
        stderr: (data: string) => console.error(`[claude:stderr] ${data.trimEnd()}`),
      },
    });

    let result = '';
    let sessionId = '';
    let usage = { inputTokens: 0, outputTokens: 0, totalCostUsd: 0 };

    try {
      for await (const msg of q) {
        yield msg as ProviderMessage;

        const m = msg as Record<string, unknown>;
        if (m.type === 'system' && m.subtype === 'init' && m.session_id) {
          sessionId = m.session_id as string;
        }
        if (m.type === 'assistant' && m.message) {
          const content = (m.message as any)?.content;
          if (Array.isArray(content)) {
            for (const b of content) {
              if (b.type === 'text') result = b.text;
            }
          }
        }
        if (m.type === 'result') {
          result = (m.result as string) || result;
          sessionId = (m.session_id as string) || sessionId;
          const u = m.usage as Record<string, number> | undefined;
          usage = {
            inputTokens: u?.input_tokens || 0,
            outputTokens: u?.output_tokens || 0,
            totalCostUsd: (m.total_cost_usd as number) || 0,
          };
        }
      }
    } finally {
      closed = true;
    }

    return { result, sessionId, usage };
  }
}
