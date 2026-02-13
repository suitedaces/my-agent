import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { Config, SandboxSettings } from './config.js';
import type { RunHandle } from './providers/types.js';
import { getProvider } from './providers/index.js';

function resolveSandbox(sandbox: SandboxSettings, channel?: string): SandboxSettings {
  const mode = sandbox.mode || 'off';
  let enabled = sandbox.enabled ?? false;

  if (mode === 'off') {
    enabled = false;
  } else if (mode === 'all') {
    enabled = true;
  } else if (mode === 'non-main') {
    enabled = !!channel && channel !== 'desktop';
  }

  return { ...sandbox, enabled };
}
import { buildSystemPrompt } from './system-prompt.js';
import { createAgentMcpServer, getCustomToolNames } from './tools/index.js';
import { getEligibleSkills, matchSkillToPrompt, type Skill } from './skills/loader.js';
import { createDefaultHooks, mergeHooks, type HookEvent, type HookCallbackMatcher } from './hooks/index.js';
import { getAllAgents } from './agents/definitions.js';
import { SessionManager, sdkMessageToSession, type SessionMessage, type MessageMetadata } from './session/manager.js';
import { loadWorkspaceFiles, ensureWorkspace } from './workspace.js';

// clean env for SDK subprocess - strip vscode vars that cause file watcher crashes
function cleanEnvForSdk(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, val] of Object.entries(process.env)) {
    if (val === undefined) continue;
    if (key.startsWith('VSCODE_')) continue;
    if (key === 'GIT_ASKPASS') continue;
    if (key === 'ELECTRON_RUN_AS_NODE') continue;
    env[key] = val;
  }
  // use a clean tmpdir so SDK file watcher doesn't hit socket files
  const sdkTmp = join(homedir(), '.dorabot', 'tmp');
  mkdirSync(sdkTmp, { recursive: true });
  env.TMPDIR = sdkTmp;
  return env;
}

export type AgentOptions = {
  prompt: string;
  sessionId?: string;
  resumeId?: string;
  config: Config;
  channel?: string;
  connectedChannels?: { channel: string; chatId: string }[];
  timezone?: string;
  ownerIdentity?: string;
  extraContext?: string;
  onMessage?: (msg: unknown) => void;
  onToolUse?: (tool: string, input: unknown) => void;
  onToolResult?: (tool: string, result: unknown) => void;
  hooks?: Partial<Record<HookEvent, HookCallbackMatcher[]>>;
  canUseTool?: (toolName: string, input: Record<string, unknown>, options: unknown) => Promise<unknown>;
  abortController?: AbortController;
  messageMetadata?: MessageMetadata;
  onRunReady?: (handle: RunHandle) => void;
};

export type AgentResult = {
  sessionId: string;
  result: string;
  messages: SessionMessage[];
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalCostUsd: number;
  };
  durationMs: number;
  usedMessageTool?: boolean;
};

export async function runAgent(opts: AgentOptions): Promise<AgentResult> {
  const {
    prompt,
    sessionId: providedSessionId,
    resumeId,
    config,
    channel,
    timezone,
    ownerIdentity,
    extraContext,
    onMessage,
    onToolUse,
    onToolResult,
    hooks: customHooks,
    messageMetadata,
  } = opts;

  const startTime = Date.now();
  const sessionManager = new SessionManager(config);

  const sessionId = providedSessionId || sessionManager.generateSessionId();

  // load eligible skills
  const skills = getEligibleSkills(config);

  // match skill to prompt if applicable
  const matchedSkill = matchSkillToPrompt(prompt, skills);
  let enhancedPrompt = prompt;
  if (matchedSkill) {
    enhancedPrompt = `[Skill: ${matchedSkill.name}]\n\n${matchedSkill.content}\n\n---\n\nUser request: ${prompt}`;
  }

  // get all available tools
  const builtInTools = [
    'Read', 'Write', 'Edit', 'Glob', 'Grep',
    'Bash', 'WebFetch', 'WebSearch',
    'Task', 'AskUserQuestion', 'TodoWrite',
  ];
  const customTools = getCustomToolNames();
  const allTools = [...builtInTools, ...customTools];

  // load workspace files (SOUL.md, USER.md, MEMORY.md, etc.)
  ensureWorkspace();
  const workspaceFiles = loadWorkspaceFiles();

  // build system prompt
  const systemPrompt = buildSystemPrompt({
    config,
    skills,
    tools: allTools,
    channel,
    connectedChannels: opts.connectedChannels,
    timezone,
    ownerIdentity,
    extraContext,
    workspaceFiles,
  });

  // create MCP server for custom tools
  const mcpServer = createAgentMcpServer();

  // get agent definitions
  const agents = getAllAgents(config);

  // create hooks
  const defaultHooks = createDefaultHooks(config);
  const hooks = customHooks
    ? mergeHooks(defaultHooks, customHooks)
    : defaultHooks;

  // run query via provider
  const effectiveSandbox = resolveSandbox(config.sandbox, channel);
  const provider = await getProvider(config);
  console.log(`[agent] runAgent starting: provider=${provider.name} model=${config.model} permissionMode=${config.permissionMode} sessionId=${sessionId} resumeId=${resumeId || 'none'} sandbox=${effectiveSandbox.enabled ? 'on' : 'off'}`);
  const q = provider.query({
    prompt: enhancedPrompt,
    systemPrompt,
    model: config.model,
    config,
    channel,
    resumeId,
    cwd: config.cwd,
    env: cleanEnvForSdk(),
    maxTurns: config.maxTurns ?? undefined,
    canUseTool: opts.canUseTool,
    agents: agents as any,
    hooks: hooks as any,
    mcpServer: { 'dorabot-tools': mcpServer },
    sandbox: effectiveSandbox,
  });

  // collect messages
  const messages: SessionMessage[] = [];
  let result = '';
  let usage = {
    inputTokens: 0,
    outputTokens: 0,
    totalCostUsd: 0,
  };
  let usedMessageTool = false;

  // always store user message to our session log
  const userMsg: SessionMessage = {
    type: 'user',
    timestamp: messageMetadata?.body ? new Date(Date.now()).toISOString() : new Date().toISOString(),
    content: { type: 'user', message: { role: 'user', content: [{ type: 'text', text: messageMetadata?.body || prompt }] } },
    metadata: messageMetadata,
  };
  messages.push(userMsg);
  sessionManager.append(sessionId, userMsg);

  // stream messages
  const toolsUsed: string[] = [];
  for await (const msg of q) {
    const m = msg as Record<string, unknown>;

    // save to session
    const sessionMsg = sdkMessageToSession(msg);
    if (sessionMsg) {
      messages.push(sessionMsg);
      sessionManager.append(sessionId, sessionMsg);
    }

    // callbacks
    if (onMessage) {
      onMessage(msg);
    }

    // handle different message types
    if (m.type === 'assistant' && m.message) {
      const assistantMsg = m.message as Record<string, unknown>;
      const content = assistantMsg.content as unknown[];
      if (Array.isArray(content)) {
        for (const block of content) {
          const b = block as Record<string, unknown>;
          if (b.type === 'tool_use') {
            const tn = b.name as string;
            if (tn === 'message') usedMessageTool = true;
            if (!toolsUsed.includes(tn)) toolsUsed.push(tn);
            if (onToolUse) onToolUse(tn, b.input);
          }
          if (b.type === 'text') {
            result = b.text as string;
          }
        }
      }
    }

    if (m.type === 'result') {
      result = (m.result as string) || result;
      usage = {
        inputTokens: ((m.usage as Record<string, number>)?.input_tokens) || 0,
        outputTokens: ((m.usage as Record<string, number>)?.output_tokens) || 0,
        totalCostUsd: (m.total_cost_usd as number) || 0,
      };
    }
  }

  const durationMs = Date.now() - startTime;

  // enrich result message with metadata
  const resultMeta: MessageMetadata = {
    channel,
    tools: toolsUsed.length > 0 ? toolsUsed : undefined,
    usage,
    durationMs,
  };
  const resultMsg: SessionMessage = {
    type: 'result',
    timestamp: new Date().toISOString(),
    content: { result },
    metadata: resultMeta,
  };
  sessionManager.append(sessionId, resultMsg);

  return {
    sessionId,
    result,
    messages,
    usage,
    durationMs,
    usedMessageTool,
  };
}

// streaming mode - returns async generator
export async function* streamAgent(opts: AgentOptions): AsyncGenerator<unknown, AgentResult, unknown> {
  const {
    prompt,
    sessionId: providedSessionId,
    resumeId,
    config,
    channel,
    timezone,
    ownerIdentity,
    extraContext,
    hooks: customHooks,
    messageMetadata,
  } = opts;

  const startTime = Date.now();
  const sessionManager = new SessionManager(config);
  const sessionId = providedSessionId || sessionManager.generateSessionId();

  const skills = getEligibleSkills(config);
  const matchedSkill = matchSkillToPrompt(prompt, skills);
  let enhancedPrompt = prompt;
  if (matchedSkill) {
    enhancedPrompt = `[Skill: ${matchedSkill.name}]\n\n${matchedSkill.content}\n\n---\n\nUser request: ${prompt}`;
  }

  const builtInTools = [
    'Read', 'Write', 'Edit', 'Glob', 'Grep',
    'Bash', 'WebFetch', 'WebSearch',
    'Task', 'AskUserQuestion', 'TodoWrite',
  ];
  const customTools = getCustomToolNames();
  const allTools = [...builtInTools, ...customTools];

  // load workspace files (SOUL.md, USER.md, MEMORY.md, etc.)
  ensureWorkspace();
  const workspaceFiles = loadWorkspaceFiles();

  const systemPrompt = buildSystemPrompt({
    config,
    skills,
    tools: allTools,
    channel,
    connectedChannels: opts.connectedChannels,
    timezone,
    ownerIdentity,
    extraContext,
    workspaceFiles,
  });

  const mcpServer = createAgentMcpServer();
  const agents = getAllAgents(config);

  const defaultHooks = createDefaultHooks(config);
  const hooks = customHooks
    ? mergeHooks(defaultHooks, customHooks)
    : defaultHooks;

  const effectiveSandbox = resolveSandbox(config.sandbox, channel);
  const provider = await getProvider(config);
  console.log(`[agent] streamAgent starting: provider=${provider.name} model=${config.model} permissionMode=${config.permissionMode} sessionId=${sessionId} resumeId=${resumeId || 'none'} sandbox=${effectiveSandbox.enabled ? 'on' : 'off'} channel=${channel || 'desktop'}`);
  const q = provider.query({
    prompt: enhancedPrompt,
    systemPrompt,
    model: config.model,
    config,
    channel,
    resumeId,
    cwd: config.cwd,
    env: cleanEnvForSdk(),
    maxTurns: config.maxTurns ?? undefined,
    canUseTool: opts.canUseTool,
    abortController: opts.abortController,
    agents: agents as any,
    hooks: hooks as any,
    mcpServer: { 'dorabot-tools': mcpServer },
    sandbox: effectiveSandbox,
    onRunReady: opts.onRunReady,
  });

  const messages: SessionMessage[] = [];
  let result = '';
  let usage = { inputTokens: 0, outputTokens: 0, totalCostUsd: 0 };
  let usedMessageTool = false;

  // always store user message to our session log
  const userMsg: SessionMessage = {
    type: 'user',
    timestamp: new Date().toISOString(),
    content: { type: 'user', message: { role: 'user', content: [{ type: 'text', text: messageMetadata?.body || prompt }] } },
    metadata: messageMetadata,
  };
  messages.push(userMsg);
  sessionManager.append(sessionId, userMsg);

  const toolsUsed: string[] = [];
  for await (const msg of q) {
    const sessionMsg = sdkMessageToSession(msg);
    if (sessionMsg) {
      messages.push(sessionMsg);
      sessionManager.append(sessionId, sessionMsg);
    }

    // yield each message to caller
    yield msg;

    const m = msg as Record<string, unknown>;
    if (m.type === 'assistant' && m.message) {
      const assistantMsg = m.message as Record<string, unknown>;
      const content = assistantMsg.content as unknown[];
      if (Array.isArray(content)) {
        for (const block of content) {
          const b = block as Record<string, unknown>;
          if (b.type === 'tool_use') {
            const tn = b.name as string;
            if (tn === 'message') usedMessageTool = true;
            if (!toolsUsed.includes(tn)) toolsUsed.push(tn);
          }
          if (b.type === 'text') {
            result = b.text as string;
          }
        }
      }
    }

    if (m.type === 'result') {
      result = (m.result as string) || result;
      usage = {
        inputTokens: ((m.usage as Record<string, number>)?.input_tokens) || 0,
        outputTokens: ((m.usage as Record<string, number>)?.output_tokens) || 0,
        totalCostUsd: (m.total_cost_usd as number) || 0,
      };
    }
  }

  const durationMs = Date.now() - startTime;
  const resultMeta: MessageMetadata = {
    channel,
    tools: toolsUsed.length > 0 ? toolsUsed : undefined,
    usage,
    durationMs,
  };
  sessionManager.append(sessionId, { type: 'result', timestamp: new Date().toISOString(), content: { result }, metadata: resultMeta });

  return {
    sessionId,
    result,
    messages,
    usage,
    durationMs,
    usedMessageTool,
  };
}
