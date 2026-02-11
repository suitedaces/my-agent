import { spawn, execFile } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import type { Provider, ProviderRunOptions, ProviderMessage, ProviderAuthStatus, ProviderQueryResult } from './types.js';

// ── codex exec event types ──────────────────────────────────────────
type ExecEvent = {
  type: string;
  [key: string]: unknown;
};

// ── OAuth constants (same client as Codex CLI / pi-ai) ──────────────
const OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const OAUTH_AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize';
const OAUTH_TOKEN_URL = 'https://auth.openai.com/oauth/token';
const OAUTH_REDIRECT_URI = 'http://localhost:1455/auth/callback';
const OAUTH_SCOPE = 'openid profile email offline_access';
const JWT_CLAIM_PATH = 'https://api.openai.com/auth';

// ── File paths ──────────────────────────────────────────────────────
const DORABOT_DIR = join(homedir(), '.dorabot');
const CODEX_OAUTH_FILE = join(DORABOT_DIR, '.codex-oauth.json');
const OPENAI_KEY_FILE = join(DORABOT_DIR, '.openai-key');

const SUCCESS_HTML = `<!doctype html><html><body><p>Authentication successful. You can close this tab.</p></body></html>`;

// ── Codex binary helpers ────────────────────────────────────────────

function codexBinary(): string {
  return process.env.CODEX_BINARY || 'codex';
}

function codexHome(): string {
  return process.env.CODEX_HOME || join(homedir(), '.codex');
}

function codexEnv(extra?: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) env[k] = v;
  }
  env.CODEX_HOME = codexHome();
  if (extra) Object.assign(env, extra);
  return env;
}

function runCodexCmd(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    execFile(codexBinary(), args, {
      env: codexEnv(),
      timeout: 30_000,
    }, (error, stdout, stderr) => {
      resolve({
        stdout: stdout?.toString() || '',
        stderr: stderr?.toString() || '',
        code: error ? (error as any).code ?? 1 : 0,
      });
    });
  });
}

export async function isCodexInstalled(): Promise<boolean> {
  try {
    const { code } = await runCodexCmd(['--version']);
    return code === 0;
  } catch {
    return false;
  }
}

// ── PKCE helpers ────────────────────────────────────────────────────

function generateCodeVerifier(): string {
  return randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

// ── JWT decode ──────────────────────────────────────────────────────

function decodeJwt(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    return JSON.parse(Buffer.from(parts[1]!, 'base64').toString());
  } catch {
    return null;
  }
}

function getAccountId(accessToken: string): string | null {
  const payload = decodeJwt(accessToken);
  const auth = payload?.[JWT_CLAIM_PATH] as Record<string, unknown> | undefined;
  const id = auth?.chatgpt_account_id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

// ── Token persistence ───────────────────────────────────────────────

type CodexOAuthTokens = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  account_id: string;
};

function ensureDorabotDir(): void {
  mkdirSync(DORABOT_DIR, { recursive: true });
}

function loadCodexOAuthTokens(): CodexOAuthTokens | null {
  try {
    if (existsSync(CODEX_OAUTH_FILE)) {
      return JSON.parse(readFileSync(CODEX_OAUTH_FILE, 'utf-8'));
    }
  } catch { /* ignore */ }
  return null;
}

function persistCodexOAuthTokens(tokens: CodexOAuthTokens): void {
  try {
    ensureDorabotDir();
    writeFileSync(CODEX_OAUTH_FILE, JSON.stringify(tokens), { mode: 0o600 });
    chmodSync(CODEX_OAUTH_FILE, 0o600);
  } catch (err) {
    console.error('[codex] failed to persist OAuth tokens:', err);
  }
}

function loadPersistedOpenAIKey(): string | undefined {
  try {
    if (existsSync(OPENAI_KEY_FILE)) {
      const key = readFileSync(OPENAI_KEY_FILE, 'utf-8').trim();
      if (key) return key;
    }
  } catch { /* ignore */ }
  return undefined;
}

function persistOpenAIKey(apiKey: string): void {
  try {
    ensureDorabotDir();
    writeFileSync(OPENAI_KEY_FILE, apiKey, { mode: 0o600 });
    chmodSync(OPENAI_KEY_FILE, 0o600);
  } catch (err) {
    console.error('[codex] failed to persist API key:', err);
  }
}

function getOpenAIApiKey(): string | undefined {
  return process.env.OPENAI_API_KEY || loadPersistedOpenAIKey();
}

// ── Token exchange & refresh ────────────────────────────────────────

async function exchangeCodexAuthCode(
  code: string,
  verifier: string,
): Promise<CodexOAuthTokens | null> {
  try {
    const res = await fetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: OAUTH_CLIENT_ID,
        code,
        code_verifier: verifier,
        redirect_uri: OAUTH_REDIRECT_URI,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error(`[codex] token exchange failed: ${res.status} ${text}`);
      return null;
    }
    const data = await res.json() as { access_token: string; refresh_token: string; expires_in: number };
    if (!data.access_token || !data.refresh_token) return null;
    const accountId = getAccountId(data.access_token);
    if (!accountId) {
      console.error('[codex] failed to extract accountId from token');
      return null;
    }
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + data.expires_in * 1000,
      account_id: accountId,
    };
  } catch (err) {
    console.error('[codex] token exchange error:', err);
    return null;
  }
}

async function refreshCodexAccessToken(refreshToken: string): Promise<CodexOAuthTokens | null> {
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
      console.error(`[codex] token refresh failed: ${res.status}`);
      return null;
    }
    const data = await res.json() as { access_token: string; refresh_token: string; expires_in: number };
    if (!data.access_token || !data.refresh_token) return null;
    const accountId = getAccountId(data.access_token);
    if (!accountId) return null;
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + data.expires_in * 1000,
      account_id: accountId,
    };
  } catch (err) {
    console.error('[codex] token refresh error:', err);
    return null;
  }
}

/** Ensure we have a valid access token, refreshing if needed */
async function ensureCodexOAuthToken(): Promise<string | null> {
  const tokens = loadCodexOAuthTokens();
  if (!tokens) return null;

  if (Date.now() > tokens.expires_at - 300_000) {
    console.log('[codex] access token expiring, refreshing...');
    const refreshed = await refreshCodexAccessToken(tokens.refresh_token);
    if (!refreshed) return null;
    persistCodexOAuthTokens(refreshed);
    return refreshed.access_token;
  }

  return tokens.access_token;
}

// ── Local OAuth callback server ─────────────────────────────────────

type OAuthServer = {
  close: () => void;
  waitForCode: () => Promise<string | null>;
};

function startLocalOAuthServer(expectedState: string): Promise<OAuthServer | null> {
  return new Promise((resolve) => {
    let capturedCode: string | null = null;
    let codeResolve: ((code: string | null) => void) | null = null;

    const server: Server = createServer((req, res) => {
      try {
        const url = new URL(req.url || '', 'http://localhost');
        if (url.pathname !== '/auth/callback') {
          res.statusCode = 404;
          res.end('Not found');
          return;
        }
        if (url.searchParams.get('state') !== expectedState) {
          res.statusCode = 400;
          res.end('State mismatch');
          return;
        }
        const code = url.searchParams.get('code');
        if (!code) {
          res.statusCode = 400;
          res.end('Missing code');
          return;
        }
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(SUCCESS_HTML);
        capturedCode = code;
        if (codeResolve) {
          codeResolve(code);
          codeResolve = null;
        }
      } catch {
        res.statusCode = 500;
        res.end('Internal error');
      }
    });

    server
      .listen(1455, '127.0.0.1', () => {
        resolve({
          close: () => { try { server.close(); } catch { /* ignore */ } },
          waitForCode: () => {
            if (capturedCode) return Promise.resolve(capturedCode);
            return new Promise<string | null>((res) => {
              codeResolve = res;
              // 120s timeout
              setTimeout(() => {
                if (!capturedCode) {
                  codeResolve = null;
                  res(null);
                }
              }, 120_000);
            });
          },
        });
      })
      .on('error', (err) => {
        console.error(`[codex] failed to bind :1455 (${(err as any).code}), falling back`);
        try { server.close(); } catch { /* ignore */ }
        resolve(null);
      });
  });
}

// ── Detection helper (exported for gateway provider.detect) ─────────

export function hasCodexAuth(): boolean {
  // our managed tokens
  const tokens = loadCodexOAuthTokens();
  if (tokens?.access_token) return true;
  // our managed API key
  if (loadPersistedOpenAIKey()) return true;
  // env var
  if (process.env.OPENAI_API_KEY) return true;
  // legacy: codex CLI auth.json
  const legacyAuth = join(codexHome(), 'auth.json');
  if (existsSync(legacyAuth)) {
    try {
      const data = JSON.parse(readFileSync(legacyAuth, 'utf-8'));
      if (data.api_key || data.token || data.access_token) return true;
    } catch { /* ignore */ }
  }
  return false;
}

export class CodexProvider implements Provider {
  readonly name = 'codex';
  private activeProcess: ReturnType<typeof spawn> | null = null;

  // in-flight OAuth state
  private _pkceVerifier: string | null = null;
  private _pkceState: string | null = null;
  private _oauthServer: OAuthServer | null = null;
  private _oauthExchangePromise: Promise<void> | null = null;
  private _oauthDone = false;

  async checkReady(): Promise<{ ready: boolean; reason?: string }> {
    try {
      const { code } = await runCodexCmd(['--version']);
      if (code !== 0) {
        return { ready: false, reason: 'codex binary not found or not working. Install with: npm i -g @openai/codex' };
      }
    } catch {
      return { ready: false, reason: 'codex binary not found. Install with: npm i -g @openai/codex' };
    }

    const auth = await this.getAuthStatus();
    if (!auth.authenticated) {
      return { ready: false, reason: auth.error || 'Not authenticated. Use provider.auth.apiKey or provider.auth.oauth' };
    }

    return { ready: true };
  }

  async getAuthStatus(): Promise<ProviderAuthStatus> {
    // 1. our managed OAuth tokens
    const token = await ensureCodexOAuthToken();
    if (token) {
      return { authenticated: true, method: 'oauth', identity: 'ChatGPT subscription' };
    }

    // 2. our managed API key
    const key = getOpenAIApiKey();
    if (key) {
      return { authenticated: true, method: 'api_key', identity: key.startsWith('sk-') ? 'OpenAI API key' : 'env:OPENAI_API_KEY' };
    }

    // 3. legacy: codex CLI auth.json
    const legacyAuth = join(codexHome(), 'auth.json');
    if (existsSync(legacyAuth)) {
      try {
        const data = JSON.parse(readFileSync(legacyAuth, 'utf-8'));
        if (data.api_key || data.token || data.access_token) {
          return { authenticated: true, method: data.api_key ? 'api_key' : 'oauth' };
        }
      } catch { /* ignore */ }
    }

    return { authenticated: false, error: 'Not authenticated with Codex' };
  }

  async loginWithApiKey(apiKey: string): Promise<ProviderAuthStatus> {
    persistOpenAIKey(apiKey);
    return { authenticated: true, method: 'api_key', identity: 'OpenAI API key' };
  }

  async loginWithOAuth(): Promise<{ authUrl: string; loginId: string }> {
    const loginId = `codex-oauth-${Date.now()}`;
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = randomBytes(16).toString('hex');

    this._pkceVerifier = codeVerifier;
    this._pkceState = state;
    this._oauthDone = false;

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: OAUTH_CLIENT_ID,
      redirect_uri: OAUTH_REDIRECT_URI,
      scope: OAUTH_SCOPE,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
      codex_cli_simplified_flow: 'true',
    });

    const authUrl = `${OAUTH_AUTHORIZE_URL}?${params}`;

    // start local callback server and begin waiting for code in background
    const server = await startLocalOAuthServer(state);
    this._oauthServer = server;

    if (server) {
      this._oauthExchangePromise = (async () => {
        try {
          const code = await server.waitForCode();
          server.close();
          this._oauthServer = null;
          if (code && this._pkceVerifier) {
            const tokens = await exchangeCodexAuthCode(code, this._pkceVerifier);
            if (tokens) {
              persistCodexOAuthTokens(tokens);
              console.log('[codex] OAuth tokens stored');
            }
          }
        } catch (err) {
          console.error('[codex] OAuth exchange error:', err);
        } finally {
          this._oauthDone = true;
          this._pkceVerifier = null;
          this._pkceState = null;
        }
      })();
    }

    return { authUrl, loginId };
  }

  async completeOAuthLogin(_loginId: string): Promise<ProviderAuthStatus> {
    // if background exchange is done, check tokens
    if (this._oauthDone) {
      return this.getAuthStatus();
    }
    // still waiting for browser callback
    return { authenticated: false, error: 'Waiting for browser authorization...' };
  }

  /** Resolve the API key/token to pass to codex exec */
  private async resolveApiKey(): Promise<string | undefined> {
    // OAuth token first
    const oauthToken = await ensureCodexOAuthToken();
    if (oauthToken) return oauthToken;
    // API key
    return getOpenAIApiKey();
  }

  async *query(opts: ProviderRunOptions): AsyncGenerator<ProviderMessage, ProviderQueryResult, unknown> {
    // resolve auth token/key and pass via env so codex exec uses it
    const apiKey = await this.resolveApiKey();
    const authEnv: Record<string, string> = { ...opts.env };
    if (apiKey) authEnv.OPENAI_API_KEY = apiKey;

    const codexConfig = opts.config.provider?.codex;
    const model = codexConfig?.model || undefined;

    const systemInstruction = opts.systemPrompt
      ? `<system_instructions>\n${opts.systemPrompt}\n</system_instructions>\n\n`
      : '';
    const fullPrompt = `${systemInstruction}${opts.prompt}`;

    const args = ['exec', '--json', '--dangerously-bypass-approvals-and-sandbox', '--skip-git-repo-check'];
    if (model) {
      args.push('-m', model);
    }
    if (opts.cwd) {
      args.push('-C', opts.cwd);
    }
    args.push(fullPrompt);

    console.log(`[codex] spawning: ${codexBinary()} exec --json ${model ? `-m ${model}` : ''}`);
    const proc = spawn(codexBinary(), args, {
      env: codexEnv(authEnv),
      cwd: opts.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.activeProcess = proc;

    proc.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString().trimEnd();
      if (msg) console.error(`[codex:stderr] ${msg}`);
    });

    // JSON-Lines reader on stdout
    const rl = createInterface({ input: proc.stdout!, crlfDelay: Infinity });
    const eventQueue: (ExecEvent | null | Error)[] = [];
    let eventResolve: (() => void) | null = null;

    const pushEvent = (ev: ExecEvent | null | Error) => {
      eventQueue.push(ev);
      if (eventResolve) {
        eventResolve();
        eventResolve = null;
      }
    };

    const nextEvent = (): Promise<ExecEvent | null | Error> => {
      if (eventQueue.length > 0) return Promise.resolve(eventQueue.shift()!);
      return new Promise<ExecEvent | null | Error>((resolve) => {
        eventResolve = () => resolve(eventQueue.shift()!);
      });
    };

    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        pushEvent(JSON.parse(trimmed) as ExecEvent);
      } catch {
        console.error(`[codex] failed to parse: ${trimmed.slice(0, 200)}`);
      }
    });

    rl.on('close', () => pushEvent(null));
    proc.on('error', (err) => pushEvent(err));
    proc.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        console.error(`[codex] process exited with code ${code}`);
      }
      pushEvent(null);
    });

    // Track state
    let sessionId = '';
    let result = '';
    let lastAgentMessage = '';
    let usage = { inputTokens: 0, outputTokens: 0, totalCostUsd: 0 };

    // stream event helpers — emit Claude-compatible stream_events so the gateway
    // and frontend handle Codex through the exact same code path as Claude
    const se = (event: Record<string, unknown>): ProviderMessage =>
      ({ type: 'stream_event', event } as ProviderMessage);
    // track per-item text for delta computation
    const itemTexts = new Map<string, string>();
    const startedBlocks = new Set<string>();

    // Event loop
    while (true) {
      const event = await nextEvent();

      if (event === null) break;

      if (event instanceof Error) {
        yield {
          type: 'result',
          subtype: 'error_max_turns',
          result: `Codex error: ${event.message}`,
          session_id: sessionId,
        } as ProviderMessage;
        break;
      }

      switch (event.type) {
        case 'thread.started': {
          sessionId = (event.thread_id as string) || `codex-${Date.now()}`;
          yield {
            type: 'system',
            subtype: 'init',
            session_id: sessionId,
            model: model || 'codex-default',
          } as ProviderMessage;
          break;
        }

        case 'turn.started': {
          // Nothing to emit
          break;
        }

        case 'turn.completed': {
          // Extract usage from turn completion
          const turnUsage = event.usage as Record<string, number> | undefined;
          if (turnUsage) {
            usage.inputTokens = turnUsage.input_tokens || 0;
            usage.outputTokens = turnUsage.output_tokens || 0;
          }

          result = lastAgentMessage || result;
          yield {
            type: 'result',
            result,
            session_id: sessionId,
            usage: {
              input_tokens: usage.inputTokens,
              output_tokens: usage.outputTokens,
            },
            total_cost_usd: 0,
          } as ProviderMessage;
          break;
        }

        case 'turn.failed': {
          const err = event.error as Record<string, string> | undefined;
          const errMsg = err?.message || 'Turn failed';
          console.error(`[codex] turn failed: ${errMsg}`);

          // If we have a partial result, return it; otherwise return the error
          result = lastAgentMessage || `Codex error: ${errMsg}`;
          yield {
            type: 'result',
            subtype: 'error_max_turns',
            result,
            session_id: sessionId,
          } as ProviderMessage;
          break;
        }

        case 'error': {
          const errMsg = (event.message as string) || 'Unknown Codex error';
          // Don't break on "Reconnecting" errors - those are retries
          if (errMsg.includes('Reconnecting')) {
            console.log(`[codex] ${errMsg}`);
            break;
          }
          console.error(`[codex] error: ${errMsg}`);
          break;
        }

        case 'item.started':
        case 'item.updated':
        case 'item.completed': {
          const item = event.item as Record<string, unknown> | undefined;
          if (!item) break;

          const itemType = (item.item_type as string) || (item.type as string);
          const itemId = (item.id as string) || `item-${Date.now()}`;

          switch (itemType) {
            case 'assistant_message':
            case 'agent_message': {
              const text = (item.text as string) || '';
              if (!text && event.type === 'item.completed') break;
              const prev = itemTexts.get(itemId) || '';

              if (!startedBlocks.has(itemId)) {
                startedBlocks.add(itemId);
                yield se({ type: 'content_block_start', content_block: { type: 'text' } });
              }

              const delta = text.slice(prev.length);
              if (delta) {
                yield se({ type: 'content_block_delta', delta: { type: 'text_delta', text: delta } });
                itemTexts.set(itemId, text);
              }

              if (event.type === 'item.completed') {
                yield se({ type: 'content_block_stop' });
                startedBlocks.delete(itemId);
                itemTexts.delete(itemId);
                lastAgentMessage = text;
                result = text;
                // assistant message for session persistence
                yield { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } } as ProviderMessage;
              }
              break;
            }

            case 'reasoning': {
              const text = (item.text as string) || '';
              if (!text && event.type === 'item.completed') break;
              const prev = itemTexts.get(itemId) || '';

              if (!startedBlocks.has(itemId)) {
                startedBlocks.add(itemId);
                yield se({ type: 'content_block_start', content_block: { type: 'thinking' } });
              }

              const delta = text.slice(prev.length);
              if (delta) {
                yield se({ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: delta } });
                itemTexts.set(itemId, text);
              }

              if (event.type === 'item.completed') {
                yield se({ type: 'content_block_stop' });
                startedBlocks.delete(itemId);
                itemTexts.delete(itemId);
                yield { type: 'assistant', message: { role: 'assistant', content: [{ type: 'thinking', thinking: text }] } } as ProviderMessage;
              }
              break;
            }

            case 'command_execution': {
              const command = (item.command as string) || '';
              const status = item.status as string;
              const output = (item.aggregated_output as string) || '';
              const toolId = `codex-${itemId}`;

              if (event.type === 'item.started') {
                yield se({ type: 'content_block_start', content_block: { type: 'tool_use', id: toolId, name: 'Bash' } });
                yield se({ type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: JSON.stringify({ command }) } });
                yield se({ type: 'content_block_stop' });
                yield { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: toolId, name: 'Bash', input: { command } }] } } as ProviderMessage;
              }

              if (event.type === 'item.completed') {
                yield {
                  type: 'result', subtype: 'tool_result', tool_use_id: toolId,
                  content: [{ type: 'text', text: output || '(no output)' }],
                  is_error: status === 'failed',
                } as ProviderMessage;
              }
              break;
            }

            case 'file_change': {
              if (event.type !== 'item.completed') break;
              const changes = (item.changes as Array<Record<string, string>>) || [];
              const firstPath = changes[0]?.path || '';
              const desc = changes.map(c => `${c.kind}: ${c.path}`).join('\n') || 'Files modified';
              const isCreate = changes.length === 1 && changes[0]?.kind === 'created';
              const toolName = isCreate ? 'Write' : 'Edit';
              const toolId = `codex-${itemId}`;
              const input = { file_path: firstPath, description: desc };

              yield se({ type: 'content_block_start', content_block: { type: 'tool_use', id: toolId, name: toolName } });
              yield se({ type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } });
              yield se({ type: 'content_block_stop' });
              yield { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: toolId, name: toolName, input }] } } as ProviderMessage;
              yield { type: 'result', subtype: 'tool_result', tool_use_id: toolId, content: [{ type: 'text', text: desc }] } as ProviderMessage;
              break;
            }

            case 'mcp_tool_call': {
              const tool = (item.tool as string) || 'unknown';
              const mcpArgs = item.arguments;
              const toolId = `codex-${itemId}`;

              if (!startedBlocks.has(itemId)) {
                startedBlocks.add(itemId);
                const input = typeof mcpArgs === 'string' ? JSON.parse(mcpArgs) : (mcpArgs || {});
                yield se({ type: 'content_block_start', content_block: { type: 'tool_use', id: toolId, name: tool } });
                yield se({ type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } });
                yield se({ type: 'content_block_stop' });
                yield { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: toolId, name: tool, input }] } } as ProviderMessage;
              }

              if (event.type === 'item.completed') {
                startedBlocks.delete(itemId);
                const mcpResult = item.result as { content: Array<Record<string, unknown>> } | undefined;
                const mcpError = item.error as { message: string } | undefined;
                const resultText = mcpError?.message
                  || (mcpResult?.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n')
                  || '(no output)';
                yield { type: 'result', subtype: 'tool_result', tool_use_id: toolId, content: [{ type: 'text', text: resultText }], is_error: item.status === 'failed' } as ProviderMessage;
              }
              break;
            }

            case 'web_search': {
              const query = (item.query as string) || '';
              const toolId = `codex-${itemId}`;

              if (!startedBlocks.has(itemId)) {
                startedBlocks.add(itemId);
                yield se({ type: 'content_block_start', content_block: { type: 'tool_use', id: toolId, name: 'WebSearch' } });
                yield se({ type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: JSON.stringify({ query }) } });
                yield se({ type: 'content_block_stop' });
                yield { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: toolId, name: 'WebSearch', input: { query } }] } } as ProviderMessage;
              }

              if (event.type === 'item.completed') {
                startedBlocks.delete(itemId);
                yield { type: 'result', subtype: 'tool_result', tool_use_id: toolId, content: [{ type: 'text', text: `Searched: ${query}` }] } as ProviderMessage;
              }
              break;
            }

            case 'todo_list': {
              if (event.type !== 'item.completed') break;
              const todos = (item.items as Array<{ text: string; completed: boolean }>) || [];
              const toolId = `codex-${itemId}`;
              const input = { todos: todos.map(t => ({ content: t.text, status: t.completed ? 'completed' : 'in_progress', activeForm: t.text })) };

              yield se({ type: 'content_block_start', content_block: { type: 'tool_use', id: toolId, name: 'TodoWrite' } });
              yield se({ type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } });
              yield se({ type: 'content_block_stop' });
              yield { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: toolId, name: 'TodoWrite', input }] } } as ProviderMessage;
              yield { type: 'result', subtype: 'tool_result', tool_use_id: toolId, content: [{ type: 'text', text: 'Plan updated' }] } as ProviderMessage;
              break;
            }

            case 'error': {
              const errMsg = (item.message as string) || 'Item error';
              console.error(`[codex] item error: ${errMsg}`);
              break;
            }

            default: {
              console.log(`[codex] unhandled item type: ${itemType}`);
              break;
            }
          }
          break;
        }

        default: {
          console.log(`[codex] unhandled event: ${event.type}`);
          break;
        }
      }

      // Break on terminal events
      if (event.type === 'turn.completed' || event.type === 'turn.failed') {
        break;
      }
    }

    this.cleanup();

    return {
      result,
      sessionId,
      usage,
    };
  }

  private cleanup(): void {
    if (this.activeProcess) {
      try {
        this.activeProcess.kill();
      } catch { /* ignore */ }
      this.activeProcess = null;
    }
  }

  async dispose(): Promise<void> {
    this.cleanup();
    if (this._oauthServer) {
      this._oauthServer.close();
      this._oauthServer = null;
    }
  }
}
