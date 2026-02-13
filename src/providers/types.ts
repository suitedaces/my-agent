import type { Config } from '../config.js';

export type RunHandle = {
  /** Push a user message into the active run's async generator */
  inject(text: string): boolean;
  /** End the generator → SDK CLI process exits */
  close(): void;
  /** Whether the generator is still alive */
  readonly active: boolean;
};

export type ProviderRunOptions = {
  prompt: string;
  systemPrompt: string;
  model: string;
  config: Config;
  channel?: string;
  resumeId?: string;
  cwd: string;
  env: Record<string, string>;
  maxTurns?: number;
  abortController?: AbortController;
  canUseTool?: (toolName: string, input: Record<string, unknown>, options: unknown) => Promise<unknown>;
  // Agent definitions, hooks, MCP servers - provider-specific, passed via config
  agents?: Record<string, unknown>;
  hooks?: unknown;
  mcpServer?: unknown; // in-process MCP server (Claude) or command spec (Codex)
  sandbox?: unknown;
  /** Called once the async message generator is ready, before SDK query starts */
  onRunReady?: (handle: RunHandle) => void;
};

// Messages emitted by providers - matches Claude SDK message format
// so the gateway and desktop don't need changes
export type ProviderMessage = {
  type: string;
  [key: string]: unknown;
};

export type ProviderAuthStatus = {
  authenticated: boolean;
  method?: 'api_key' | 'oauth';
  identity?: string;
  error?: string;
  /** Model currently configured (e.g. "claude-opus-4-5-20251101") */
  model?: string;
  /** Claude Code CLI version (e.g. "2.0.76") */
  cliVersion?: string;
  /** Permission mode (e.g. "default", "bypassPermissions") */
  permissionMode?: string;
};

export type ProviderQueryResult = {
  result: string;
  sessionId: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalCostUsd: number;
  };
};

export interface Provider {
  readonly name: string;

  /** Check if this provider is ready to run (binary exists, auth valid, etc.) */
  checkReady(): Promise<{ ready: boolean; reason?: string }>;

  /** Get current auth status */
  getAuthStatus(): Promise<ProviderAuthStatus>;

  /** Authenticate with an API key */
  loginWithApiKey(apiKey: string): Promise<ProviderAuthStatus>;

  /** Start OAuth flow - returns URL to open in browser */
  loginWithOAuth?(): Promise<{ authUrl: string; loginId: string }>;

  /** Wait for OAuth completion after user completes browser flow */
  completeOAuthLogin?(loginId: string): Promise<ProviderAuthStatus>;

  /** Run a query - yields SDK-compatible messages, returns final result */
  query(opts: ProviderRunOptions): AsyncGenerator<ProviderMessage, ProviderQueryResult, unknown>;

  /** Clean up resources */
  dispose?(): Promise<void>;
}
