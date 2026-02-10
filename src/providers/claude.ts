import { query } from '@anthropic-ai/claude-agent-sdk';
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import type { Provider, ProviderRunOptions, ProviderMessage, ProviderAuthStatus, ProviderQueryResult } from './types.js';

const KEY_FILE = join(homedir(), '.dorabot', '.anthropic-key');

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
    const dir = join(homedir(), '.dorabot');
    mkdirSync(dir, { recursive: true });
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

/**
 * Probe the Claude CLI to detect auth session and extract rich status info.
 * Runs `claude -p --output-format stream-json --verbose --max-budget-usd 0.001 "."`.
 * The init message tells us the auth method, model, CLI version, etc.
 * Returns rich ProviderAuthStatus or null on failure.
 */
async function probeClaudeAuth(): Promise<ProviderAuthStatus | null> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), 20000);

    // Run claude with minimal budget - we only need the init message
    const child = execFile('claude', [
      '-p', '--output-format', 'stream-json', '--verbose',
      '--max-budget-usd', '0.001',
      '--no-session-persistence',
      '.',
    ], { timeout: 20000, env: { ...process.env } }, (err, stdout) => {
      clearTimeout(timeout);
      if (err && !stdout) {
        // CLI failed to run at all
        resolve(null);
        return;
      }
      try {
        // Parse the first line (init message)
        const lines = stdout.trim().split('\n');
        for (const line of lines) {
          const msg = JSON.parse(line);
          if (msg.type === 'system' && msg.subtype === 'init') {
            const apiKeySource = msg.apiKeySource as string | undefined;
            const model = msg.model as string | undefined;
            const cliVersion = msg.claude_code_version as string | undefined;
            const permMode = msg.permissionMode as string | undefined;

            // apiKeySource: "none" means OAuth subscription, anything else means API key
            const isOAuth = apiKeySource === 'none';
            const method = isOAuth ? 'oauth' as const : 'api_key' as const;
            const identity = isOAuth ? 'Claude subscription' : (apiKeySource || 'API key');

            resolve({
              authenticated: true,
              method,
              identity,
              model,
              cliVersion,
              permissionMode: permMode,
            });
            return;
          }
        }
        resolve(null);
      } catch {
        resolve(null);
      }
    });

    // Kill early once we get the init line (don't wait for full response)
    child.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      if (text.includes('"subtype":"init"')) {
        // We got what we need, kill the process quickly
        setTimeout(() => child.kill('SIGTERM'), 100);
      }
    });
  });
}

/**
 * Check if Claude Code CLI is installed.
 */
async function isClaudeInstalled(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('claude', ['--version'], { timeout: 5000 }, (err) => {
      resolve(!err);
    });
  });
}

/**
 * Run `claude setup-token` to trigger OAuth login for subscription users.
 * Returns { authUrl } with the URL the user needs to open, or spawns the
 * interactive flow and monitors for completion.
 */
async function runSetupToken(): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    const child = execFile('claude', ['setup-token'], {
      timeout: 120000, // 2 min for user to complete browser auth
      env: { ...process.env },
    }, (err) => {
      if (err) {
        resolve({ success: false, error: err.message });
      } else {
        resolve({ success: true });
      }
    });

    // setup-token is interactive - it opens a browser and waits
    // We need to pipe through so the user can interact
    child.stdin?.end();
  });
}

export class ClaudeProvider implements Provider {
  readonly name = 'claude';
  private _cachedAuth: ProviderAuthStatus | null = null;
  private _pendingSetupToken: string | null = null;
  private _setupTokenProcess: ChildProcess | null = null;
  private _setupTokenPromise: Promise<boolean> | null = null;

  constructor() {
    // Load persisted key into env if not already set
    if (!process.env.ANTHROPIC_API_KEY) {
      const saved = loadPersistedKey();
      if (saved) process.env.ANTHROPIC_API_KEY = saved;
    }
  }

  async checkReady(): Promise<{ ready: boolean; reason?: string }> {
    const status = await this.getAuthStatus();
    if (!status.authenticated) {
      return { ready: false, reason: status.error || 'Not authenticated. Log in with Claude Code or provide an API key.' };
    }
    return { ready: true };
  }

  async getAuthStatus(): Promise<ProviderAuthStatus> {
    // Return cached if available
    if (this._cachedAuth) return this._cachedAuth;

    // First check if Claude Code CLI is even installed
    const installed = await isClaudeInstalled();
    if (!installed) {
      return { authenticated: false, error: 'Claude Code CLI not found. Install it with: npm install -g @anthropic-ai/claude-code' };
    }

    // Check if user has an API key configured in dorabot
    const apiKey = getApiKey();
    if (apiKey) {
      const v = await validateApiKey(apiKey);
      if (v.valid) {
        // Probe CLI anyway to get model/version info
        const probe = await probeClaudeAuth();
        this._cachedAuth = {
          authenticated: true,
          method: 'api_key',
          identity: 'Anthropic API key',
          model: probe?.model,
          cliVersion: probe?.cliVersion,
          permissionMode: probe?.permissionMode,
        };
        return this._cachedAuth;
      }
      // Key exists but invalid - don't fall through to OAuth probe, report the error
      return { authenticated: false, method: 'api_key', error: v.error };
    }

    // No API key - probe for Claude OAuth session (subscription auth)
    const probe = await probeClaudeAuth();
    if (probe?.authenticated) {
      this._cachedAuth = probe;
      return probe;
    }

    // Nothing found
    return { authenticated: false, error: 'No auth found. Run "claude setup-token" for subscription auth, or provide an Anthropic API key.' };
  }

  async loginWithApiKey(apiKey: string): Promise<ProviderAuthStatus> {
    // Validate first
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
   * Start OAuth login via `claude setup-token`.
   * This spawns the CLI's setup-token flow which opens a browser for PKCE auth.
   * The desktop app should show the user a "complete login in browser" prompt.
   */
  async loginWithOAuth(): Promise<{ authUrl: string; loginId: string }> {
    const loginId = `claude-setup-${Date.now()}`;
    this._pendingSetupToken = loginId;

    // Spawn setup-token in background - it opens browser automatically
    const child = spawn('claude', ['setup-token'], {
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Capture any URL output for the desktop to show
    let capturedUrl = '';
    child.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      // Look for URLs in the output
      const urlMatch = text.match(/https?:\/\/[^\s]+/);
      if (urlMatch) capturedUrl = urlMatch[0];
    });
    child.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      const urlMatch = text.match(/https?:\/\/[^\s]+/);
      if (urlMatch) capturedUrl = urlMatch[0];
    });

    // Store the child process so completeOAuthLogin can check it
    this._setupTokenProcess = child;
    this._setupTokenPromise = new Promise<boolean>((resolve) => {
      child.on('exit', (code) => {
        this._setupTokenProcess = null;
        resolve(code === 0);
      });
      child.on('error', () => {
        this._setupTokenProcess = null;
        resolve(false);
      });
      // Timeout after 2 minutes
      setTimeout(() => {
        if (this._setupTokenProcess) {
          child.kill('SIGTERM');
          this._setupTokenProcess = null;
        }
        resolve(false);
      }, 120000);
    });

    // Give it a moment to output the URL
    await new Promise((r) => setTimeout(r, 2000));

    return {
      authUrl: capturedUrl || 'claude://setup-token (complete in terminal)',
      loginId,
    };
  }

  /**
   * Check if the setup-token flow completed successfully.
   */
  async completeOAuthLogin(loginId: string): Promise<ProviderAuthStatus> {
    if (this._pendingSetupToken !== loginId) {
      return { authenticated: false, error: 'No pending setup-token flow for this loginId' };
    }

    // Wait for the setup-token process to finish (or timeout)
    const success = await this._setupTokenPromise;
    this._pendingSetupToken = null;
    this._setupTokenPromise = null;

    if (!success) {
      return { authenticated: false, error: 'Setup token flow failed or was cancelled' };
    }

    // Re-probe auth to confirm it worked
    this._cachedAuth = null;
    return this.getAuthStatus();
  }

  /** Reset cached auth so next getAuthStatus() re-probes */
  resetAuth(): void {
    this._cachedAuth = null;
    delete process.env.ANTHROPIC_API_KEY;
    clearPersistedKey();
  }

  async *query(opts: ProviderRunOptions): AsyncGenerator<ProviderMessage, ProviderQueryResult, unknown> {
    const q = query({
      prompt: opts.prompt,
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

    return { result, sessionId, usage };
  }
}
