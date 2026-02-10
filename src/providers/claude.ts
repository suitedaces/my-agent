import { query } from '@anthropic-ai/claude-agent-sdk';
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
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

export class ClaudeProvider implements Provider {
  readonly name = 'claude';
  private _validated = false; // cache: key has been validated at least once this session

  constructor() {
    // Load persisted key into env if not already set
    if (!process.env.ANTHROPIC_API_KEY) {
      const saved = loadPersistedKey();
      if (saved) process.env.ANTHROPIC_API_KEY = saved;
    }
  }

  async checkReady(): Promise<{ ready: boolean; reason?: string }> {
    const key = getApiKey();
    if (!key) {
      return { ready: false, reason: 'ANTHROPIC_API_KEY not set. Add it via Settings or set the environment variable.' };
    }
    // Validate on first check
    if (!this._validated) {
      const v = await validateApiKey(key);
      if (!v.valid) return { ready: false, reason: v.error || 'Invalid API key' };
      this._validated = true;
    }
    return { ready: true };
  }

  async getAuthStatus(): Promise<ProviderAuthStatus> {
    const key = getApiKey();
    if (!key) {
      return { authenticated: false, error: 'ANTHROPIC_API_KEY not set' };
    }
    // If already validated this session, skip re-check
    if (this._validated) {
      return { authenticated: true, method: 'api_key' };
    }
    // Validate the key
    const v = await validateApiKey(key);
    if (!v.valid) {
      return { authenticated: false, method: 'api_key', error: v.error };
    }
    this._validated = true;
    return { authenticated: true, method: 'api_key' };
  }

  async loginWithApiKey(apiKey: string): Promise<ProviderAuthStatus> {
    // Validate first
    const v = await validateApiKey(apiKey);
    if (!v.valid) {
      return { authenticated: false, method: 'api_key', error: v.error };
    }
    process.env.ANTHROPIC_API_KEY = apiKey;
    persistKey(apiKey);
    this._validated = true;
    return { authenticated: true, method: 'api_key' };
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
