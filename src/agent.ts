import { query } from '@anthropic-ai/claude-agent-sdk';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { Config } from './config.js';
import { buildSystemPrompt } from './system-prompt.js';
import { createAgentMcpServer, getCustomToolNames } from './tools/index.js';
import { getEligibleSkills, matchSkillToPrompt, type Skill } from './skills/loader.js';
import { createDefaultHooks, mergeHooks, type HookEvent, type HookCallbackMatcher } from './hooks/index.js';
import { getAllAgents } from './agents/definitions.js';
import { SessionManager, sdkMessageToSession, type SessionMessage } from './session/manager.js';

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
  const sdkTmp = join(homedir(), '.my-agent', 'tmp');
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
  timezone?: string;
  ownerIdentity?: string;
  extraContext?: string;
  onMessage?: (msg: unknown) => void;
  onToolUse?: (tool: string, input: unknown) => void;
  onToolResult?: (tool: string, result: unknown) => void;
  hooks?: Partial<Record<HookEvent, HookCallbackMatcher[]>>;
  canUseTool?: (toolName: string, input: Record<string, unknown>, options: unknown) => Promise<unknown>;
  abortController?: AbortController;
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

  // build system prompt
  const systemPrompt = buildSystemPrompt({
    config,
    skills,
    tools: allTools,
    channel,
    timezone,
    ownerIdentity,
    extraContext,
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

  // run query
  console.log(`[agent] runAgent starting: model=${config.model} permissionMode=${config.permissionMode} sessionId=${sessionId} resumeId=${resumeId || 'none'}`);
  const q = query({
    prompt: enhancedPrompt,
    options: {
      model: config.model,
      systemPrompt,
      tools: { type: 'preset', preset: 'claude_code' } as any,
      agents: agents as any,
      hooks: hooks as any,
      mcpServers: { 'my-agent-tools': mcpServer } as any,
      resume: resumeId,
      permissionMode: config.permissionMode as any,
      allowDangerouslySkipPermissions: config.permissionMode === 'bypassPermissions',
      sandbox: config.sandbox as any,
      cwd: config.cwd,
      env: cleanEnvForSdk(),
      maxTurns: 50,
      includePartialMessages: true,
      canUseTool: opts.canUseTool as any,
      stderr: (data: string) => console.error(`[agent:stderr] ${data.trimEnd()}`),
    },
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

  // store user message only for new runs (resume replays history)
  if (!resumeId) {
    const userMsg: SessionMessage = {
      type: 'user',
      timestamp: new Date().toISOString(),
      content: { type: 'user', message: { role: 'user', content: [{ type: 'text', text: prompt }] } },
    };
    messages.push(userMsg);
    sessionManager.append(sessionId, userMsg);
  }

  // stream messages
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
            if (b.name === 'message') {
              usedMessageTool = true;
            }
            if (onToolUse) {
              onToolUse(b.name as string, b.input);
            }
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

  const systemPrompt = buildSystemPrompt({
    config,
    skills,
    tools: allTools,
    channel,
    timezone,
    ownerIdentity,
    extraContext,
  });

  const mcpServer = createAgentMcpServer();
  const agents = getAllAgents(config);

  const defaultHooks = createDefaultHooks(config);
  const hooks = customHooks
    ? mergeHooks(defaultHooks, customHooks)
    : defaultHooks;

  console.log(`[agent] streamAgent starting: model=${config.model} permissionMode=${config.permissionMode} sessionId=${sessionId} resumeId=${resumeId || 'none'}`);
  const q = query({
    prompt: enhancedPrompt,
    options: {
      model: config.model,
      systemPrompt,
      tools: { type: 'preset', preset: 'claude_code' },
      agents,
      hooks: hooks as any,
      mcpServers: { 'my-agent-tools': mcpServer },
      resume: resumeId,
      permissionMode: config.permissionMode,
      allowDangerouslySkipPermissions: config.permissionMode === 'bypassPermissions',
      sandbox: config.sandbox,
      cwd: config.cwd,
      env: cleanEnvForSdk(),
      maxTurns: 50,
      includePartialMessages: true,
      canUseTool: opts.canUseTool as any,
      abortController: opts.abortController,
      stderr: (data: string) => console.error(`[agent:stderr] ${data.trimEnd()}`),
    },
  });

  const messages: SessionMessage[] = [];
  let result = '';
  let usage = { inputTokens: 0, outputTokens: 0, totalCostUsd: 0 };
  let usedMessageTool = false;

  if (!resumeId) {
    const userMsg: SessionMessage = {
      type: 'user',
      timestamp: new Date().toISOString(),
      content: { type: 'user', message: { role: 'user', content: [{ type: 'text', text: prompt }] } },
    };
    messages.push(userMsg);
    sessionManager.append(sessionId, userMsg);
  }

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
          if (b.type === 'tool_use' && b.name === 'message') {
            usedMessageTool = true;
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

  return {
    sessionId,
    result,
    messages,
    usage,
    durationMs: Date.now() - startTime,
    usedMessageTool,
  };
}
