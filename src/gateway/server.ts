import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'node:http';
import { createServer as createTlsServer } from 'node:https';
import { readdirSync, statSync, readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, renameSync, chmodSync, watch, type FSWatcher } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve as pathResolve, join } from 'node:path';
import { homedir } from 'node:os';

const resolve = (p: string) => pathResolve(p.startsWith('~') ? p.replace('~', homedir()) : p);
import type { Config } from '../config.js';
import { isPathAllowed, saveConfig, ALWAYS_DENIED, type SecurityConfig, type ToolPolicyConfig } from '../config.js';
import type { WsMessage, WsResponse, WsEvent, GatewayContext } from './types.js';
import { SessionRegistry } from './session-registry.js';
import { ChannelManager } from './channel-manager.js';
import { SessionManager } from '../session/manager.js';
import { streamAgent, type AgentResult } from '../agent.js';
import type { RunHandle } from '../providers/types.js';
import { startHeartbeatRunner, type HeartbeatRunner } from '../heartbeat/runner.js';
import { startCronRunner, loadCronJobs, saveCronJobs, type CronRunner } from '../cron/scheduler.js';
import { checkSkillEligibility, loadAllSkills, findSkillByName } from '../skills/loader.js';
import type { InboundMessage } from '../channels/types.js';
import { getAllChannelStatuses } from '../channels/index.js';
import { loginWhatsApp, logoutWhatsApp, isWhatsAppLinked } from '../channels/whatsapp/login.js';
import { getDefaultAuthDir } from '../channels/whatsapp/session.js';
import { validateTelegramToken } from '../channels/telegram/bot.js';
import { getChannelHandler } from '../tools/messaging.js';
import { setCronRunner } from '../tools/index.js';
import { loadBoard, saveBoard, type BoardTask } from '../tools/board.js';
import { getProvider, getProviderByName, disposeAllProviders } from '../providers/index.js';
import { isClaudeInstalled, hasOAuthTokens, getApiKey as getClaudeApiKey } from '../providers/claude.js';
import { isCodexInstalled, hasCodexAuth } from '../providers/codex.js';
import type { ProviderName } from '../config.js';
import { randomUUID, randomBytes } from 'node:crypto';
import { classifyToolCall, cleanToolName, isToolAllowed, type Tier } from './tool-policy.js';

const DEFAULT_PORT = 18789;
const DEFAULT_HOST = 'localhost';

const TOOL_EMOJI: Record<string, string> = {
  Read: '\ud83d\udcc4', Write: '\ud83d\udcdd', Edit: '\u270f\ufe0f',
  Glob: '\ud83d\udcc2', Grep: '\ud83d\udd0d', Bash: '\u26a1',
  WebFetch: '\ud83c\udf10', WebSearch: '\ud83d\udd0e', Task: '\ud83e\udd16',
  AskUserQuestion: '\ud83d\udcac', TodoWrite: '\ud83d\udcdd',
  NotebookEdit: '\ud83d\udcd3', message: '\ud83d\udcac',
  screenshot: '\ud83d\udcf8', browser: '\ud83c\udf10',
  schedule_reminder: '\u23f0', schedule_recurring: '\u23f0',
  schedule_cron: '\u23f0', list_reminders: '\u23f0', cancel_reminder: '\u23f0',
};

const TOOL_LABEL: Record<string, string> = {
  Read: 'read', Write: 'wrote', Edit: 'edited',
  Glob: 'searched files', Grep: 'searched', Bash: 'ran',
  WebFetch: 'fetched', WebSearch: 'searched web', Task: 'ran task',
  AskUserQuestion: 'asked', TodoWrite: 'updated tasks',
  NotebookEdit: 'edited notebook', message: 'replied',
  screenshot: 'took screenshot', browser: 'browsed',
  schedule_reminder: 'scheduled', schedule_recurring: 'scheduled',
  schedule_cron: 'scheduled', list_reminders: 'listed reminders',
  cancel_reminder: 'cancelled reminder',
};

const TOOL_ACTIVE_LABEL: Record<string, string> = {
  Read: 'reading', Write: 'writing', Edit: 'editing',
  Glob: 'searching files', Grep: 'searching', Bash: 'running',
  WebFetch: 'fetching', WebSearch: 'searching web', Task: 'running task',
  AskUserQuestion: 'asking', TodoWrite: 'updating tasks',
  NotebookEdit: 'editing notebook', message: 'replying',
  screenshot: 'taking screenshot', browser: 'browsing',
  schedule_reminder: 'scheduling', schedule_recurring: 'scheduling',
  schedule_cron: 'scheduling', list_reminders: 'listing reminders',
  cancel_reminder: 'cancelling reminder',
};

function shortPath(p: string): string {
  if (!p) return '';
  const parts = p.replace(/^\/+/, '').split('/');
  return parts.length <= 2 ? parts.join('/') : parts.slice(-2).join('/');
}

function extractToolDetail(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'Read': return shortPath(String(input.file_path || ''));
    case 'Write': return shortPath(String(input.file_path || ''));
    case 'Edit': return shortPath(String(input.file_path || ''));
    case 'Glob': return String(input.pattern || '').slice(0, 40);
    case 'Grep': {
      const pat = String(input.pattern || '').slice(0, 25);
      const p = input.path ? shortPath(String(input.path)) : '';
      return p ? `"${pat}" in ${p}` : `"${pat}"`;
    }
    case 'Bash': return String(input.command || '').split('\n')[0].slice(0, 40);
    case 'WebFetch': {
      try { return new URL(String(input.url || '')).hostname; } catch { return ''; }
    }
    case 'WebSearch': return `"${String(input.query || '').slice(0, 35)}"`;
    case 'Task': return String(input.description || '').slice(0, 30);
    case 'message': return 'replying';
    case 'browser': return String(input.action || '');
    default: return '';
  }
}

type ToolEntry = { name: string; detail: string };

function buildToolStatusText(completed: ToolEntry[], current: ToolEntry | null): string {
  const lines: string[] = [];
  for (const t of completed) {
    if (t.name === 'message') {
      lines.push(`\u2705 \ud83d\udcac replied`);
    } else {
      const emoji = TOOL_EMOJI[t.name] || '\u2705';
      const label = TOOL_LABEL[t.name] || t.name;
      const text = t.detail ? `${label} ${t.detail}` : label;
      lines.push(`\u2705 ${emoji} ${text}`);
    }
  }
  if (current) {
    if (current.name === 'message') {
      lines.push(`\ud83d\udcac replying...`);
    } else {
      const emoji = TOOL_EMOJI[current.name] || '\u23f3';
      const label = TOOL_ACTIVE_LABEL[current.name] || current.name;
      const text = current.detail ? `${label} ${current.detail}` : `${label}...`;
      lines.push(`\u23f3 ${emoji} ${text}`);
    }
  }
  return lines.join('\n');
}

export type GatewayOptions = {
  config: Config;
  port?: number;
  host?: string;
};

export type Gateway = {
  close: () => Promise<void>;
  broadcast: (event: WsEvent) => void;
  sessionRegistry: SessionRegistry;
  channelManager: ChannelManager;
  heartbeatRunner: HeartbeatRunner | null;
  cronRunner: CronRunner | null;
  context: GatewayContext;
};

export async function startGateway(opts: GatewayOptions): Promise<Gateway> {
  const { config } = opts;
  const port = opts.port || config.gateway?.port || DEFAULT_PORT;
  const host = opts.host || config.gateway?.host || DEFAULT_HOST;
  const startedAt = Date.now();

  // stable gateway auth token — reuse existing, only generate on first run
  const tokenPath = join(homedir(), '.dorabot', 'gateway-token');
  mkdirSync(join(homedir(), '.dorabot'), { recursive: true });
  let gatewayToken: string;
  if (existsSync(tokenPath)) {
    gatewayToken = readFileSync(tokenPath, 'utf-8').trim();
    console.log(`[gateway] reusing auth token from ${tokenPath}`);
  } else {
    gatewayToken = randomBytes(32).toString('hex');
    writeFileSync(tokenPath, gatewayToken, { mode: 0o600 });
    console.log(`[gateway] auth token created at ${tokenPath}`);
  }

  const clients = new Map<WebSocket, { authenticated: boolean }>();

  const broadcast = (event: WsEvent): void => {
    const data = JSON.stringify(event);
    for (const [ws, state] of clients) {
      if (ws.readyState === WebSocket.OPEN && state.authenticated) {
        ws.send(data);
      }
    }
  };

  // file system watcher manager
  const fileWatchers = new Map<string, { watcher: FSWatcher; refCount: number }>();

  const startWatching = (path: string) => {
    const resolved = resolve(path);
    const existing = fileWatchers.get(resolved);

    if (existing) {
      existing.refCount++;
      return;
    }

    try {
      const watcher = watch(resolved, { recursive: false }, (eventType, filename) => {
        console.log(`[gateway] fs.watch: ${eventType} in ${resolved}${filename ? '/' + filename : ''}`);
        broadcast({
          event: 'fs.change',
          data: { path: resolved, eventType, filename: filename || null, timestamp: Date.now() },
        });
      });

      fileWatchers.set(resolved, { watcher, refCount: 1 });
      console.log(`[gateway] started watching: ${resolved}`);
    } catch (err) {
      console.error(`[gateway] failed to watch ${resolved}:`, err);
    }
  };

  const stopWatching = (path: string) => {
    const resolved = resolve(path);
    const existing = fileWatchers.get(resolved);

    if (!existing) return;

    existing.refCount--;

    if (existing.refCount <= 0) {
      existing.watcher.close();
      fileWatchers.delete(resolved);
      console.log(`[gateway] stopped watching: ${resolved}`);
    }
  };

  const sessionRegistry = new SessionRegistry();
  sessionRegistry.loadFromDisk();
  const fileSessionManager = new SessionManager(config);

  const IDLE_TIMEOUT_MS = 4 * 60 * 60 * 1000; // 4h
  // status messages sent to channels while agent is working
  const statusMessages = new Map<string, { channel: string; chatId: string; messageId: string }>();
  // remember the owner's chat ID per channel so the agent can reach them cross-channel
  const ownerChatIds = new Map<string, string>();
  // queued messages for sessions with active runs
  const pendingMessages = new Map<string, InboundMessage[]>();
  // accumulated tool log per active run
  const toolLogs = new Map<string, { completed: ToolEntry[]; current: { name: string; inputJson: string; detail: string } | null; lastEditAt: number }>();
  // active RunHandles for message injection into running agent sessions
  const runHandles = new Map<string, RunHandle>();

  // background runs state
  type BackgroundRun = {
    id: string; sessionKey: string; prompt: string;
    startedAt: number; status: 'running' | 'completed' | 'error';
    result?: string; error?: string;
  };
  const backgroundRuns = new Map<string, BackgroundRun>();

  // guard against overlapping WhatsApp login attempts
  let whatsappLoginInProgress = false;

  // process a channel message (or batched messages) through the agent
  async function processChannelMessage(msg: InboundMessage, batchedBodies?: string[]) {
    ownerChatIds.set(msg.channel, msg.chatId);
    const session = sessionRegistry.getOrCreate({
      channel: msg.channel,
      chatType: msg.chatType,
      chatId: msg.chatId,
    });

    // update metadata index
    fileSessionManager.setMetadata(session.sessionId, {
      channel: msg.channel,
      chatId: msg.chatId,
      chatType: msg.chatType,
      senderName: msg.senderName,
    });

    // send status message to channel + start typing indicator
    const handler = getChannelHandler(msg.channel);
    let statusMsgId: string | undefined;
    let typingInterval: ReturnType<typeof setInterval> | undefined;
    if (handler) {
      try {
        if (handler.typing) handler.typing(msg.chatId).catch(() => {});
        const sent = await handler.send(msg.chatId, 'thinking...');
        statusMsgId = sent.id;
        statusMessages.set(session.key, { channel: msg.channel, chatId: msg.chatId, messageId: sent.id });
      } catch {}
      if (handler.typing) {
        typingInterval = setInterval(() => {
          handler.typing!(msg.chatId).catch(() => {});
        }, 4500);
      }
    }

    // init tool log for this run
    toolLogs.set(session.key, { completed: [], current: null, lastEditAt: 0 });

    const body = batchedBodies
      ? `Multiple messages:\n${batchedBodies.map((b, i) => `${i + 1}. ${b}`).join('\n')}`
      : msg.body;

    // sanitize sender name to prevent injection
    const safeSender = (msg.senderName || msg.senderId).replace(/[<>"'&\n\r]/g, '_').slice(0, 50);
    // escape < and > in body to prevent XML tag breakout
    const safeBody = body.replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // build media attribute if present
    const mediaAttr = msg.mediaType ? ` media_type="${msg.mediaType}" media_path="${msg.mediaPath || ''}"` : '';

    const channelPrompt = [
      `<incoming_message channel="${msg.channel}" sender="${safeSender}" chat="${msg.chatId}"${mediaAttr}>`,
      safeBody || (msg.mediaPath ? `[Attached: ${msg.mediaType || 'file'} at ${msg.mediaPath}]` : ''),
      `</incoming_message>`,
      '',
    ].join('\n');

    const result = await handleAgentRun({
      prompt: channelPrompt,
      sessionKey: session.key,
      source: `${msg.channel}/${msg.chatId}`,
      channel: msg.channel,
      messageMetadata: {
        channel: msg.channel,
        chatId: msg.chatId,
        chatType: msg.chatType,
        senderName: msg.senderName,
        body: body,
        replyToId: msg.replyToId,
        mediaType: msg.mediaType,
        mediaPath: msg.mediaPath,
      },
    });

    // clean up typing indicator and tool log
    if (typingInterval) clearInterval(typingInterval);
    toolLogs.delete(session.key);

    // delete the progress/status message, then send result as new message if needed
    if (handler && statusMsgId) {
      try { await handler.delete(statusMsgId, msg.chatId); } catch {}
    }
    statusMessages.delete(session.key);
    if (handler && !result?.usedMessageTool && result?.result) {
      try { await handler.send(msg.chatId, result.result); } catch {}
    }

    // process any queued messages
    const queued = pendingMessages.get(session.key);
    if (queued && queued.length > 0) {
      const bodies = queued.map(m => m.body);
      pendingMessages.delete(session.key);
      // use the last message as the "main" message for metadata
      const lastMsg = queued[queued.length - 1];
      await processChannelMessage(lastMsg, bodies);
    }
  }

  // channel manager handles incoming messages from whatsapp/telegram
  const channelManager = new ChannelManager({
    config,
    onMessage: async (msg: InboundMessage) => {
      broadcast({ event: 'channel.message', data: msg });

      if (msg.channel === 'desktop') {
        // desktop handled via chat.send RPC, not here
        return;
      }

      let session = sessionRegistry.getOrCreate({
        channel: msg.channel,
        chatType: msg.chatType,
        chatId: msg.chatId,
      });

      // idle timeout: reset session if too long since last message
      const gap = Date.now() - session.lastMessageAt;
      if (session.messageCount > 0 && gap > IDLE_TIMEOUT_MS) {
        console.log(`[gateway] idle timeout for ${session.key} (${Math.floor(gap / 3600000)}h), starting new session`);
        fileSessionManager.setMetadata(session.sessionId, { sdkSessionId: undefined });
        sessionRegistry.remove(session.key);
        session = sessionRegistry.getOrCreate({
          channel: msg.channel,
          chatType: msg.chatType,
          chatId: msg.chatId,
        });
      }

      sessionRegistry.incrementMessages(session.key);

      // if agent is already running for this chat, try injection first
      if (session.activeRun) {
        const handle = runHandles.get(session.key);
        if (handle?.active) {
          // sanitize sender name and body for injection
          const safeSender = (msg.senderName || msg.senderId).replace(/[<>"'&\n\r]/g, '_').slice(0, 50);
          const safeBody = msg.body.replace(/</g, '&lt;').replace(/>/g, '&gt;');
          const mediaAttr = msg.mediaType ? ` media_type="${msg.mediaType}" media_path="${msg.mediaPath || ''}"` : '';
          const channelPrompt = [
            `<incoming_message channel="${msg.channel}" sender="${safeSender}" chat="${msg.chatId}"${mediaAttr}>`,
            safeBody || (msg.mediaPath ? `[Attached: ${msg.mediaType || 'file'} at ${msg.mediaPath}]` : ''),
            `</incoming_message>`,
          ].join('\n');
          handle.inject(channelPrompt);
          broadcast({ event: 'agent.user_message', data: {
            source: `${msg.channel}/${msg.chatId}`, sessionKey: session.key,
            prompt: msg.body, injected: true, timestamp: Date.now(),
          }});
          const handler = getChannelHandler(msg.channel);
          if (handler) {
            try { await handler.send(msg.chatId, 'noted, working on it...'); } catch {}
          }
          return;
        }

        // fallback: queue in pendingMessages (non-injection case)
        const queue = pendingMessages.get(session.key) || [];
        queue.push(msg);
        pendingMessages.set(session.key, queue);

        const handler = getChannelHandler(msg.channel);
        if (handler) {
          try { await handler.send(msg.chatId, 'got it, I\'ll get to this after I\'m done'); } catch {}
        }
        return;
      }

      await processChannelMessage(msg);
    },
    onCommand: async (channel, cmd, chatId) => {
      const chatType = 'dm';
      const key = sessionRegistry.makeKey({ channel, chatType, chatId });

      if (cmd === 'new') {
        const old = sessionRegistry.get(key);
        if (old) fileSessionManager.setMetadata(old.sessionId, { sdkSessionId: undefined });
        sessionRegistry.remove(key);
        return `session reset. ${old ? `old: ${old.messageCount} messages.` : ''} new session started.`;
      }

      if (cmd === 'status') {
        const session = sessionRegistry.get(key);
        if (!session) return 'no active session for this chat.';
        const age = Date.now() - session.lastMessageAt;
        const ageMin = Math.floor(age / 60000);
        return [
          `session: ${session.sessionId.slice(0, 30)}`,
          `messages: ${session.messageCount}`,
          `last activity: ${ageMin}m ago`,
          `active: ${session.activeRun ? 'yes' : 'no'}`,
        ].join('\n');
      }
    },
    onApprovalResponse: (requestId, approved, reason) => {
      const pending = pendingApprovals.get(requestId);
      if (!pending) return;
      pendingApprovals.delete(requestId);
      if (pending.timeout) clearTimeout(pending.timeout);
      pending.resolve({ approved, reason });
    },
    onQuestionResponse: (requestId, selectedIndex, label) => {
      console.log(`[canUseTool] question response: requestId=${requestId} index=${selectedIndex} label=${label}`);
      const pending = pendingChannelQuestions.get(requestId);
      if (!pending) {
        console.log(`[canUseTool] no pending question for ${requestId} (map size: ${pendingChannelQuestions.size})`);
        return;
      }
      pendingChannelQuestions.delete(requestId);
      pending.resolve(label);
    },
    onStatus: (status) => {
      broadcast({ event: 'channel.status', data: status });
    },
  });

  // heartbeat
  let heartbeatRunner: HeartbeatRunner | null = null;
  let lastHeartbeatStatus: string | null = null;

  if (config.heartbeat?.enabled) {
    heartbeatRunner = startHeartbeatRunner({
      config,
      onMessage: (text) => {
        broadcast({ event: 'heartbeat.result', data: { text, timestamp: Date.now() } });
      },
      onEvent: (event) => {
        lastHeartbeatStatus = event.status;
        broadcast({ event: 'heartbeat.run', data: { ...event, timestamp: Date.now() } });
      },
    });
  }

  // cron
  let cronRunner: CronRunner | null = null;
  if (config.cron?.enabled !== false) {
    cronRunner = startCronRunner({
      config,
      onJobRun: (job, result) => {
        broadcast({ event: 'cron.result', data: { job: job.id, name: job.name, ...result, timestamp: Date.now() } });
      },
    });
    // make cron runner available to MCP tools
    setCronRunner(cronRunner);
  }

  const context: GatewayContext = {
    config,
    sessionRegistry,
    channelManager,
    heartbeatRunner,
    cronRunner,
    broadcast,
  };

  // pending AskUserQuestion requests waiting for desktop answers
  const pendingQuestions = new Map<string, {
    resolve: (answers: Record<string, string>) => void;
    reject: (err: Error) => void;
  }>();

  // pending AskUserQuestion requests waiting for channel responses (telegram inline keyboard / whatsapp text reply)
  const pendingChannelQuestions = new Map<string, {
    resolve: (label: string) => void;
    options: { label: string }[];
  }>();

  // pending tool approval requests waiting for user decision
  const pendingApprovals = new Map<string, {
    resolve: (decision: { approved: boolean; reason?: string; modifiedInput?: Record<string, unknown> }) => void;
    toolName: string;
    input: Record<string, unknown>;
    timeout: NodeJS.Timeout | null;
  }>();

  async function waitForApproval(requestId: string, toolName: string, input: Record<string, unknown>, timeoutMs?: number): Promise<{ approved: boolean; reason?: string; modifiedInput?: Record<string, unknown> }> {
    return new Promise((resolve) => {
      const timer = timeoutMs ? setTimeout(() => {
        pendingApprovals.delete(requestId);
        resolve({ approved: false, reason: 'approval timeout' });
      }, timeoutMs) : null;

      pendingApprovals.set(requestId, { resolve, toolName, input, timeout: timer });
    });
  }

  function getChannelToolPolicy(channel?: string): ToolPolicyConfig | undefined {
    if (!channel || channel === 'desktop') return undefined;
    if (channel === 'whatsapp') return config.channels?.whatsapp?.tools;
    if (channel === 'telegram') return config.channels?.telegram?.tools;
    return undefined;
  }

  function getChannelPathOverride(channel?: string): { allowedPaths?: string[]; deniedPaths?: string[] } | undefined {
    if (!channel || channel === 'desktop') return undefined;
    const ch = channel === 'whatsapp' ? config.channels?.whatsapp : channel === 'telegram' ? config.channels?.telegram : undefined;
    if (!ch) return undefined;
    if (!ch.allowedPaths?.length && !ch.deniedPaths?.length) return undefined;
    return { allowedPaths: ch.allowedPaths, deniedPaths: ch.deniedPaths };
  }

  function makeCanUseTool(runChannel?: string, runChatId?: string) {
    return async (toolName: string, input: Record<string, unknown>) => {
      return canUseToolImpl(toolName, input, runChannel, runChatId);
    };
  }

  const canUseTool = async (toolName: string, input: Record<string, unknown>) => {
    return canUseToolImpl(toolName, input, undefined, undefined);
  };

  const canUseToolImpl = async (toolName: string, input: Record<string, unknown>, runChannel?: string, runChatId?: string) => {
    // AskUserQuestion — route to channel or desktop
    if (toolName === 'AskUserQuestion') {
      const questions = input.questions as unknown[];
      if (!questions) {
        return { behavior: 'allow' as const, updatedInput: input };
      }

      // channel (telegram/whatsapp): send question and wait for response
      if ((runChannel === 'telegram' || runChannel === 'whatsapp') && runChatId) {
        console.log(`[canUseTool] AskUserQuestion on ${runChannel}, chatId=${runChatId}, ${(questions as any[]).length} question(s)`);
        const answers: Record<string, string> = {};
        for (let qi = 0; qi < (questions as any[]).length; qi++) {
          const q = (questions as any[])[qi];
          const questionText: string = q.question || `Question ${qi + 1}`;
          const opts = (q.options || []) as { label: string; description?: string }[];
          if (!opts.length) continue;

          const requestId = randomUUID();
          try {
            await channelManager.sendQuestion({
              requestId,
              chatId: runChatId,
              question: questionText,
              options: opts,
            }, runChannel);
            console.log(`[canUseTool] sent question to ${runChannel}: ${requestId}`);
          } catch (err) {
            console.error(`[canUseTool] failed to send question:`, err);
            answers[questionText] = opts[0]?.label || '';
            continue;
          }

          const label = await new Promise<string>((resolve) => {
            pendingChannelQuestions.set(requestId, { resolve, options: opts });
            setTimeout(() => {
              if (pendingChannelQuestions.has(requestId)) {
                pendingChannelQuestions.delete(requestId);
                resolve(opts[0]?.label || '');
              }
            }, 120000);
          });
          // SDK expects question text as key
          answers[questionText] = label;
        }
        return {
          behavior: 'allow' as const,
          updatedInput: { questions, answers },
        };
      }

      // desktop: broadcast and wait
      const authCount = Array.from(clients.values()).filter(c => c.authenticated).length;
      if (authCount === 0) {
        return {
          behavior: 'deny' as const,
          message: 'No UI client connected to answer questions. Proceed with your best judgment.',
        };
      }

      const requestId = randomUUID();
      broadcast({
        event: 'agent.ask_user',
        data: { requestId, questions, timestamp: Date.now() },
      });

      const answers = await new Promise<Record<string, string>>((resolveQ, rejectQ) => {
        pendingQuestions.set(requestId, { resolve: resolveQ, reject: rejectQ });
        setTimeout(() => {
          if (pendingQuestions.has(requestId)) {
            pendingQuestions.delete(requestId);
            rejectQ(new Error('Question timeout - no answer received'));
          }
        }, 300000);
      });

      return {
        behavior: 'allow' as const,
        updatedInput: { questions, answers },
      };
    }

    // check tool allow/deny policy (channel-specific + global)
    const cleanName = cleanToolName(toolName);
    const channelToolPolicy = getChannelToolPolicy(runChannel);
    const globalToolPolicy = config.security?.tools;
    if (!isToolAllowed(cleanName, channelToolPolicy, globalToolPolicy)) {
      return { behavior: 'deny' as const, message: `tool '${cleanName}' blocked by policy` };
    }

    // classify tool call (use clean name so FORM_MAP in desktop matches)
    const tier = classifyToolCall(cleanName, input);

    // respect permissionMode and approvalMode
    const approvalMode = config.security?.approvalMode || 'approve-sensitive';

    if (config.permissionMode === 'bypassPermissions' || config.permissionMode === 'dontAsk' || approvalMode === 'autonomous') {
      if (tier !== 'auto-allow') {
        broadcast({ event: 'agent.tool_notify', data: { toolName: cleanName, input, tier, timestamp: Date.now() } });
      }
      return { behavior: 'allow' as const, updatedInput: input };
    }

    if (config.permissionMode === 'acceptEdits') {
      const isEdit = ['Write', 'Edit'].includes(cleanName);
      if (isEdit || tier === 'auto-allow') {
        return { behavior: 'allow' as const, updatedInput: input };
      }
      if (tier === 'notify') {
        broadcast({ event: 'agent.tool_notify', data: { toolName: cleanName, input, tier, timestamp: Date.now() } });
        return { behavior: 'allow' as const, updatedInput: input };
      }
    }

    // lockdown — require approval for everything except reads
    if (approvalMode === 'lockdown' && tier !== 'auto-allow') {
      const requestId = randomUUID();
      broadcast({
        event: 'agent.tool_approval',
        data: { requestId, toolName: cleanName, input, tier: 'require-approval', timestamp: Date.now() },
      });
      channelManager.sendApprovalRequest({ requestId, toolName: cleanName, input, chatId: runChatId }, runChannel).catch(() => {});
      const decision = await waitForApproval(requestId, cleanName, input);
      if (decision.approved) {
        return { behavior: 'allow' as const, updatedInput: decision.modifiedInput || input };
      }
      return { behavior: 'deny' as const, message: decision.reason || 'user denied' };
    }

    if (tier === 'auto-allow') {
      return { behavior: 'allow' as const, updatedInput: input };
    }

    if (tier === 'notify') {
      broadcast({ event: 'agent.tool_notify', data: { toolName: cleanName, input, tier, timestamp: Date.now() } });
      return { behavior: 'allow' as const, updatedInput: input };
    }

    if (tier === 'require-approval') {
      const requestId = randomUUID();
      broadcast({
        event: 'agent.tool_approval',
        data: { requestId, toolName: cleanName, input, tier, timestamp: Date.now() },
      });
      channelManager.sendApprovalRequest({ requestId, toolName: cleanName, input, chatId: runChatId }, runChannel).catch(() => {});

      const decision = await waitForApproval(requestId, cleanName, input);

      if (decision.approved) {
        return { behavior: 'allow' as const, updatedInput: decision.modifiedInput || input };
      }
      return { behavior: 'deny' as const, message: decision.reason || 'user denied' };
    }

    return { behavior: 'allow' as const, updatedInput: input };
  };

  // track which channel each active run belongs to (for tool policy lookups)
  const activeRunChannels = new Map<string, string>();

  // agent run queue (one per session key)
  const runQueues = new Map<string, Promise<void>>();
  const activeAbortControllers = new Map<string, AbortController>();

  async function handleAgentRun(params: {
    prompt: string;
    sessionKey: string;
    source: string;
    channel?: string;
    extraContext?: string;
    messageMetadata?: import('../session/manager.js').MessageMetadata;
  }): Promise<AgentResult | null> {
    const { prompt, sessionKey, source, channel, extraContext, messageMetadata } = params;
    console.log(`[gateway] agent run: source=${source} sessionKey=${sessionKey} prompt="${prompt.slice(0, 80)}..."`);

    const prev = runQueues.get(sessionKey) || Promise.resolve();
    let result: AgentResult | null = null;

    const run = prev.then(async () => {
      sessionRegistry.setActiveRun(sessionKey, true);
      if (channel) activeRunChannels.set(sessionKey, channel);
      broadcast({ event: 'status.update', data: { activeRun: true, source, sessionKey } });
      broadcast({ event: 'agent.user_message', data: { source, sessionKey, prompt, timestamp: Date.now() } });
      const runStart = Date.now();

      const abortController = new AbortController();
      activeAbortControllers.set(sessionKey, abortController);

      // run the stream loop, returns result
      async function executeStream(resumeId: string | undefined): Promise<AgentResult> {
        const session = sessionRegistry.get(sessionKey);
        const connected = getAllChannelStatuses()
          .filter(s => s.connected && ownerChatIds.has(s.channel))
          .map(s => ({ channel: s.channel, chatId: ownerChatIds.get(s.channel)! }));
        const gen = streamAgent({
          prompt,
          sessionId: session?.sessionId,
          resumeId,
          config,
          channel,
          connectedChannels: connected,
          extraContext,
          canUseTool: makeCanUseTool(channel, messageMetadata?.chatId),
          abortController,
          messageMetadata,
          onRunReady: (handle) => { runHandles.set(sessionKey, handle); },
        });

        let agentText = '';
        let agentSessionId = '';
        let agentUsage = { inputTokens: 0, outputTokens: 0, totalCostUsd: 0 };
        let usedMessageTool = false;
        let hadStreamEvents = false;

        for await (const msg of gen) {
          const m = msg as Record<string, unknown>;

          if (m.type === 'system' && m.subtype === 'init' && m.session_id) {
            agentSessionId = m.session_id as string;
            sessionRegistry.setSdkSessionId(sessionKey, agentSessionId);
            fileSessionManager.setMetadata(session?.sessionId || '', { sdkSessionId: agentSessionId });
          }

          if (m.type === 'stream_event') {
            hadStreamEvents = true;
            const event = m.event as Record<string, unknown>;
            broadcast({
              event: 'agent.stream',
              data: { source, sessionKey, event, parentToolUseId: m.parent_tool_use_id || null, timestamp: Date.now() },
            });

            if (event.type === 'content_block_start') {
              const cb = event.content_block as Record<string, unknown>;
              if (cb?.type === 'tool_use') {
                const toolName = cleanToolName(cb.name as string);
                if (toolName === 'message') usedMessageTool = true;
                broadcast({
                  event: 'agent.tool_use',
                  data: { source, sessionKey, tool: toolName, timestamp: Date.now() },
                });

                const tl = toolLogs.get(sessionKey);
                if (tl) {
                  // push previous tool as completed
                  if (tl.current) tl.completed.push({ name: tl.current.name, detail: tl.current.detail });
                  tl.current = { name: toolName, inputJson: '', detail: '' };
                  // throttled status edit
                  const sm = statusMessages.get(sessionKey);
                  if (sm) {
                    const now = Date.now();
                    if (now - tl.lastEditAt >= 2500) {
                      tl.lastEditAt = now;
                      const text = buildToolStatusText(tl.completed, tl.current);
                      const h = getChannelHandler(sm.channel);
                      if (h) { try { await h.edit(sm.messageId, text, sm.chatId); } catch {} }
                    }
                  }
                }
              }
            }

            // accumulate tool input json
            if (event.type === 'content_block_delta') {
              const delta = event.delta as Record<string, unknown>;
              if (delta?.type === 'input_json_delta') {
                const tl = toolLogs.get(sessionKey);
                if (tl?.current) {
                  tl.current.inputJson += String(delta.partial_json || '');
                }
              }
            }

            // tool input complete — extract detail and force update (no throttle)
            if (event.type === 'content_block_stop') {
              const tl = toolLogs.get(sessionKey);
              if (tl?.current && tl.current.inputJson) {
                try {
                  const input = JSON.parse(tl.current.inputJson);
                  tl.current.detail = extractToolDetail(tl.current.name, input);
                } catch {}
                // force edit — detail is worth showing immediately
                const sm = statusMessages.get(sessionKey);
                if (sm) {
                  tl.lastEditAt = Date.now();
                  const text = buildToolStatusText(tl.completed, tl.current);
                  const h = getChannelHandler(sm.channel);
                  if (h) { try { await h.edit(sm.messageId, text, sm.chatId); } catch {} }
                }
              }
            }
          }

          if (m.type === 'assistant') {
            // Only broadcast full assistant messages for non-streaming providers (Codex).
            // Claude streams via stream_event — broadcasting here too would cause duplicates.
            if (!hadStreamEvents) {
              broadcast({
                event: 'agent.message',
                data: { source, sessionKey, message: m, parentToolUseId: m.parent_tool_use_id || null, timestamp: Date.now() },
              });
            }
            const assistantMsg = m.message as Record<string, unknown>;
            const content = assistantMsg?.content as unknown[];
            if (Array.isArray(content)) {
              for (const block of content) {
                const b = block as Record<string, unknown>;
                if (b.type === 'text') agentText = b.text as string;
                // broadcast tool_use for non-streaming providers (status bar + channel status)
                if (!hadStreamEvents && b.type === 'tool_use') {
                  const toolName = cleanToolName(b.name as string);
                  if (toolName === 'message') usedMessageTool = true;
                  broadcast({
                    event: 'agent.tool_use',
                    data: { source, sessionKey, tool: toolName, timestamp: Date.now() },
                  });

                  const tl = toolLogs.get(sessionKey);
                  if (tl) {
                    if (tl.current) tl.completed.push({ name: tl.current.name, detail: tl.current.detail });
                    const inputStr = typeof b.input === 'string' ? b.input : JSON.stringify(b.input || {});
                    let detail = '';
                    try { detail = extractToolDetail(toolName, JSON.parse(inputStr)); } catch {}
                    tl.current = { name: toolName, inputJson: inputStr, detail };
                    tl.lastEditAt = Date.now();
                    const sm = statusMessages.get(sessionKey);
                    if (sm) {
                      const text = buildToolStatusText(tl.completed, tl.current);
                      const h = getChannelHandler(sm.channel);
                      if (h) { try { await h.edit(sm.messageId, text, sm.chatId); } catch {} }
                    }
                  }
                }
              }
            }
          }

          if (m.type === 'user') {
            const userMsg = (m as any).message;
            const content = userMsg?.content;
            if (Array.isArray(content)) {
              for (const block of content) {
                if (block.type === 'tool_result') {
                  let resultText = '';
                  let imageData: string | undefined;
                  if (typeof block.content === 'string') {
                    resultText = block.content;
                  } else if (Array.isArray(block.content)) {
                    resultText = block.content
                      .filter((c: any) => c.type === 'text')
                      .map((c: any) => c.text)
                      .join('\n');
                    const img = block.content.find((c: any) => c.type === 'image');
                    if (img) {
                      const data = img.data || img.source?.data;
                      const mime = img.mimeType || img.source?.media_type || 'image/png';
                      if (data) imageData = `data:${mime};base64,${data}`;
                    }
                  }
                  broadcast({
                    event: 'agent.tool_result',
                    data: {
                      source,
                      sessionKey,
                      tool_use_id: block.tool_use_id,
                      content: resultText.slice(0, 2000),
                      imageData,
                      is_error: block.is_error || false,
                      parentToolUseId: (m as any).parent_tool_use_id || null,
                      timestamp: Date.now(),
                    },
                  });
                }
              }
            }
          }

          // Codex tool results come as type: 'result' with subtype: 'tool_result'
          if (m.type === 'result' && m.subtype === 'tool_result') {
            const toolUseId = m.tool_use_id as string;
            const resultContent = Array.isArray(m.content)
              ? (m.content as Array<Record<string, unknown>>).filter(c => c.type === 'text').map(c => c.text).join('\n')
              : String(m.content || '');
            broadcast({
              event: 'agent.tool_result',
              data: {
                source,
                sessionKey,
                tool_use_id: toolUseId,
                content: resultContent.slice(0, 2000),
                is_error: m.is_error || false,
                timestamp: Date.now(),
              },
            });
          }

          if (m.type === 'result' && m.subtype !== 'tool_result') {
            agentText = (m.result as string) || agentText;
            agentSessionId = (m.session_id as string) || agentSessionId;
            if (agentSessionId && session) {
              sessionRegistry.setSdkSessionId(sessionKey, agentSessionId);
              fileSessionManager.setMetadata(session.sessionId, { sdkSessionId: agentSessionId });
            }
            const u = m.usage as Record<string, number>;
            agentUsage = {
              inputTokens: u?.input_tokens || 0,
              outputTokens: u?.output_tokens || 0,
              totalCostUsd: (m.total_cost_usd as number) || 0,
            };
          }
        }

        return {
          sessionId: agentSessionId || '',
          result: agentText,
          messages: [],
          usage: agentUsage,
          durationMs: Date.now() - runStart,
          usedMessageTool,
        };
      }

      try {
        const session = sessionRegistry.get(sessionKey);
        const resumeId = session?.sdkSessionId;

        try {
          result = await executeStream(resumeId);
        } catch (err) {
          // if resume failed, clear stale sdkSessionId and retry fresh
          if (resumeId) {
            const errMsg = err instanceof Error ? err.message : String(err);
            console.warn(`[gateway] resume failed for ${sessionKey}, retrying fresh: ${errMsg}`);
            sessionRegistry.setSdkSessionId(sessionKey, undefined);
            if (session) fileSessionManager.setMetadata(session.sessionId, { sdkSessionId: undefined });
            result = await executeStream(undefined);
          } else {
            throw err;
          }
        }

        console.log(`[gateway] agent done: source=${source} result="${result.result.slice(0, 100)}..." cost=$${result.usage.totalCostUsd?.toFixed(4) || '?'}`);

        broadcast({
          event: 'agent.result',
          data: {
            source,
            sessionKey,
            sessionId: result.sessionId,
            result: result.result,
            usage: result.usage,
            timestamp: Date.now(),
          },
        });

        // broadcast board.update if agent used board tools
        const tl = toolLogs.get(sessionKey);
        if (tl) {
          const allTools = [...tl.completed.map(t => t.name), tl.current?.name].filter(Boolean);
          if (allTools.some(t => t?.startsWith('board_') || t?.startsWith('mcp__dorabot-tools__board_'))) {
            broadcast({ event: 'board.update', data: {} });
          }
        }
      } catch (err) {
        console.error(`[gateway] agent error: source=${source}`, err);
        broadcast({
          event: 'agent.error',
          data: { source, sessionKey, error: err instanceof Error ? err.message : String(err), timestamp: Date.now() },
        });
      } finally {
        activeAbortControllers.delete(sessionKey);
        activeRunChannels.delete(sessionKey);
        runHandles.delete(sessionKey);
        sessionRegistry.setActiveRun(sessionKey, false);
        broadcast({ event: 'status.update', data: { activeRun: false, source, sessionKey } });
      }
    });

    runQueues.set(sessionKey, run.catch(() => {}));
    await run;
    return result;
  }

  // rpc handler
  async function handleRpc(msg: WsMessage): Promise<WsResponse> {
    const { method, params, id } = msg;

    try {
      switch (method) {
        case 'status': {
          return {
            id,
            result: {
              running: true,
              startedAt,
              channels: channelManager.getStatuses(),
              sessions: sessionRegistry.list(),
              heartbeat: heartbeatRunner ? {
                enabled: config.heartbeat?.enabled ?? false,
                interval: config.heartbeat?.every || '30m',
                lastRunAt: null,
                nextDueAt: null,
                lastStatus: lastHeartbeatStatus,
              } : null,
              cron: cronRunner ? {
                enabled: true,
                jobCount: cronRunner.listJobs().length,
              } : null,
            },
          };
        }

        case 'chat.send': {
          const prompt = params?.prompt as string;
          if (!prompt) return { id, error: 'prompt required' };

          const sessionKey = 'desktop:dm:default';
          const session = sessionRegistry.getOrCreate({
            channel: 'desktop',
            chatId: 'default',
          });
          sessionRegistry.incrementMessages(session.key);
          fileSessionManager.setMetadata(session.sessionId, { channel: 'desktop', chatId: 'default', chatType: 'dm' });

          // try injection into active run first
          const handle = runHandles.get(sessionKey);
          if (handle?.active) {
            handle.inject(prompt);
            broadcast({ event: 'agent.user_message', data: {
              source: 'desktop/chat', sessionKey, prompt, injected: true, timestamp: Date.now(),
            }});
            return { id, result: { sessionKey, sessionId: session.sessionId, injected: true } };
          }

          // no active session — start new run
          handleAgentRun({
            prompt,
            sessionKey,
            source: 'desktop/chat',
          });

          return { id, result: { sessionKey, sessionId: session.sessionId, queued: true } };
        }

        case 'agent.abort': {
          const sk = (params?.sessionKey as string) || 'desktop:dm:default';
          const ac = activeAbortControllers.get(sk);
          if (!ac) return { id, error: 'no active run for that session' };
          ac.abort();
          console.log(`[gateway] agent aborted: sessionKey=${sk}`);
          return { id, result: { aborted: true, sessionKey: sk } };
        }

        case 'chat.answerQuestion': {
          const requestId = params?.requestId as string;
          const answers = params?.answers as Record<string, string>;
          if (!requestId) return { id, error: 'requestId required' };
          if (!answers) return { id, error: 'answers required' };
          const pending = pendingQuestions.get(requestId);
          if (!pending) return { id, error: 'no pending question with that ID' };
          pendingQuestions.delete(requestId);
          pending.resolve(answers);
          return { id, result: { answered: true } };
        }

        case 'chat.history': {
          const sessionId = params?.sessionId as string;
          if (!sessionId) return { id, error: 'sessionId required' };
          const messages = fileSessionManager.load(sessionId);
          return { id, result: messages };
        }

        case 'sessions.list': {
          const fileSessions = fileSessionManager.list();
          return { id, result: fileSessions };
        }

        case 'sessions.get': {
          const sessionId = params?.sessionId as string;
          if (!sessionId) return { id, error: 'sessionId required' };
          const messages = fileSessionManager.load(sessionId);
          return { id, result: { sessionId, messages } };
        }

        case 'sessions.delete': {
          const sessionId = params?.sessionId as string;
          if (!sessionId) return { id, error: 'sessionId required' };
          const deleted = fileSessionManager.delete(sessionId);
          return { id, result: { deleted } };
        }

        case 'sessions.reset': {
          const channel = params?.channel as string;
          const chatId = params?.chatId as string;
          if (!channel || !chatId) return { id, error: 'channel and chatId required' };
          const key = sessionRegistry.makeKey({ channel, chatId });
          const oldSession = sessionRegistry.get(key);
          if (oldSession) fileSessionManager.setMetadata(oldSession.sessionId, { sdkSessionId: undefined });
          sessionRegistry.remove(key);
          return { id, result: { reset: true, key } };
        }

        case 'sessions.resume': {
          const sessionId = params?.sessionId as string;
          if (!sessionId) return { id, error: 'sessionId required' };
          const meta = fileSessionManager.getMetadata(sessionId);
          if (!meta) return { id, error: 'session metadata not found' };

          const ch = meta.channel || (params?.channel as string) || 'desktop';
          const cid = meta.chatId || (params?.chatId as string) || 'default';
          const ct = meta.chatType || 'dm';
          const key = sessionRegistry.makeKey({ channel: ch, chatId: cid, chatType: ct });

          const existing = sessionRegistry.get(key);
          if (existing?.activeRun) return { id, error: 'cannot resume while agent is running' };

          sessionRegistry.remove(key);
          const entry = sessionRegistry.getOrCreate({ channel: ch, chatId: cid, chatType: ct, sessionId });
          if (meta.sdkSessionId) {
            sessionRegistry.setSdkSessionId(key, meta.sdkSessionId);
          }

          return { id, result: { resumed: true, key, sessionId, sdkSessionId: meta.sdkSessionId || null } };
        }

        case 'channels.status': {
          return { id, result: channelManager.getStatuses() };
        }

        case 'channels.start': {
          const channelId = params?.channel as string;
          if (!channelId) return { id, error: 'channel required' };
          await channelManager.startChannel(channelId);
          return { id, result: { started: channelId } };
        }

        case 'channels.stop': {
          const channelId = params?.channel as string;
          if (!channelId) return { id, error: 'channel required' };
          await channelManager.stopChannel(channelId);
          return { id, result: { stopped: channelId } };
        }

        case 'channels.whatsapp.status': {
          const authDir = config.channels?.whatsapp?.authDir || getDefaultAuthDir();
          const linked = isWhatsAppLinked(authDir);
          return { id, result: { linked } };
        }

        case 'channels.whatsapp.login': {
          const authDir = config.channels?.whatsapp?.authDir || getDefaultAuthDir();
          if (whatsappLoginInProgress) {
            return { id, result: { success: true, started: true, inProgress: true } };
          }

          whatsappLoginInProgress = true;
          broadcast({ event: 'whatsapp.login_status', data: { status: 'connecting' } });

          void (async () => {
            try {
              const result = await loginWhatsApp(authDir, (qr) => {
                broadcast({ event: 'whatsapp.qr', data: { qr } });
                broadcast({ event: 'whatsapp.login_status', data: { status: 'qr_ready' } });
              });

              if (result.success) {
                // auto-enable whatsapp in config
                if (!config.channels) config.channels = {};
                if (!config.channels.whatsapp) config.channels.whatsapp = {};
                config.channels.whatsapp.enabled = true;
                saveConfig(config);

                broadcast({ event: 'whatsapp.login_status', data: { status: 'connected' } });

                // auto-start the monitor
                await channelManager.startChannel('whatsapp');
              } else {
                broadcast({ event: 'whatsapp.login_status', data: { status: 'failed', error: result.error } });
              }
            } catch (err) {
              const error = err instanceof Error ? err.message : String(err);
              broadcast({ event: 'whatsapp.login_status', data: { status: 'failed', error } });
            } finally {
              whatsappLoginInProgress = false;
            }
          })();

          return { id, result: { success: true, started: true } };
        }

        case 'channels.whatsapp.logout': {
          whatsappLoginInProgress = false;
          await channelManager.stopChannel('whatsapp');
          const authDir = config.channels?.whatsapp?.authDir || getDefaultAuthDir();
          await logoutWhatsApp(authDir);

          if (config.channels?.whatsapp) {
            config.channels.whatsapp.enabled = false;
            saveConfig(config);
          }

          broadcast({ event: 'whatsapp.login_status', data: { status: 'disconnected' } });
          return { id, result: { success: true } };
        }

        case 'channels.telegram.status': {
          const tokenFile = config.channels?.telegram?.tokenFile
            || join(homedir(), '.dorabot', 'telegram', 'token');
          const linked = existsSync(tokenFile) && readFileSync(tokenFile, 'utf-8').trim().length > 0;
          const botUsername = linked ? (config.channels?.telegram?.accountId || null) : null;
          return { id, result: { linked, botUsername } };
        }

        case 'channels.telegram.link': {
          const token = (params?.token as string || '').trim();
          if (!token) return { id, error: 'token is required' };
          if (!token.includes(':')) {
            return { id, error: 'Invalid token format. Expected format: 123456:ABC-DEF1234...' };
          }

          let botInfo: { id: number; username: string; firstName: string };
          try {
            botInfo = await validateTelegramToken(token);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { id, error: `Invalid token: ${msg}` };
          }

          const tokenDir = join(homedir(), '.dorabot', 'telegram');
          mkdirSync(tokenDir, { recursive: true });
          writeFileSync(join(tokenDir, 'token'), token, { mode: 0o600 });

          if (!config.channels) config.channels = {};
          if (!config.channels.telegram) config.channels.telegram = {};
          config.channels.telegram.enabled = true;
          config.channels.telegram.accountId = `@${botInfo.username}`;
          saveConfig(config);

          broadcast({
            event: 'telegram.link_status',
            data: { status: 'linked', botUsername: `@${botInfo.username}` },
          });

          try {
            await channelManager.startChannel('telegram');
          } catch (err) {
            console.error('[gateway] telegram auto-start failed:', err);
          }

          return {
            id,
            result: {
              success: true,
              botId: botInfo.id,
              botUsername: `@${botInfo.username}`,
              botName: botInfo.firstName,
            },
          };
        }

        case 'channels.telegram.unlink': {
          await channelManager.stopChannel('telegram');

          const tokenFile = config.channels?.telegram?.tokenFile
            || join(homedir(), '.dorabot', 'telegram', 'token');
          if (existsSync(tokenFile)) rmSync(tokenFile);

          if (config.channels?.telegram) {
            config.channels.telegram.enabled = false;
            delete config.channels.telegram.accountId;
            saveConfig(config);
          }

          broadcast({ event: 'telegram.link_status', data: { status: 'unlinked' } });
          return { id, result: { success: true } };
        }

        case 'cron.list': {
          const jobs = cronRunner?.listJobs() || loadCronJobs();
          return { id, result: jobs };
        }

        case 'cron.add': {
          if (!cronRunner) return { id, error: 'cron not enabled' };
          const job = cronRunner.addJob(params as any);
          return { id, result: job };
        }

        case 'cron.remove': {
          if (!cronRunner) return { id, error: 'cron not enabled' };
          const jobId = params?.id as string;
          if (!jobId) return { id, error: 'id required' };
          const removed = cronRunner.removeJob(jobId);
          return { id, result: { removed } };
        }

        case 'cron.toggle': {
          const jobId = params?.id as string;
          if (!jobId) return { id, error: 'id required' };
          const jobs = loadCronJobs();
          const job = jobs.find(j => j.id === jobId);
          if (!job) return { id, error: 'job not found' };
          job.enabled = !job.enabled;
          saveCronJobs(jobs);
          return { id, result: { id: jobId, enabled: job.enabled } };
        }

        case 'cron.run': {
          if (!cronRunner) return { id, error: 'cron not enabled' };
          const jobId = params?.id as string;
          if (!jobId) return { id, error: 'id required' };
          const runResult = await cronRunner.runJobNow(jobId);
          return { id, result: runResult };
        }

        case 'board.list': {
          const board = loadBoard();
          return { id, result: board.tasks };
        }

        case 'board.add': {
          const board = loadBoard();
          const title = params?.title as string;
          if (!title) return { id, error: 'title required' };
          const now = new Date().toISOString();
          const ids = board.tasks.map(t => parseInt(t.id, 10)).filter(n => !isNaN(n));
          const newId = String((ids.length > 0 ? Math.max(...ids) : 0) + 1);
          const source = (params?.source as string) || 'user';
          const task: BoardTask = {
            id: newId,
            title,
            description: params?.description as string | undefined,
            status: (params?.status as BoardTask['status']) || (source === 'user' ? 'approved' : 'proposed'),
            priority: (params?.priority as BoardTask['priority']) || 'medium',
            source: source as 'agent' | 'user',
            createdAt: now,
            updatedAt: now,
            tags: params?.tags as string[] | undefined,
          };
          board.tasks.push(task);
          saveBoard(board);
          broadcast({ event: 'board.update', data: {} });
          return { id, result: task };
        }

        case 'board.update': {
          const taskId = params?.id as string;
          if (!taskId) return { id, error: 'id required' };
          const board = loadBoard();
          const task = board.tasks.find(t => t.id === taskId);
          if (!task) return { id, error: 'task not found' };
          const now = new Date().toISOString();
          if (params?.status !== undefined) task.status = params.status as BoardTask['status'];
          if (params?.title !== undefined) task.title = params.title as string;
          if (params?.description !== undefined) task.description = params.description as string;
          if (params?.priority !== undefined) task.priority = params.priority as BoardTask['priority'];
          if (params?.result !== undefined) task.result = params.result as string;
          if (params?.tags !== undefined) task.tags = params.tags as string[];
          task.updatedAt = now;
          if (task.status === 'done') task.completedAt = now;
          saveBoard(board);
          broadcast({ event: 'board.update', data: {} });
          return { id, result: task };
        }

        case 'board.delete': {
          const taskId = params?.id as string;
          if (!taskId) return { id, error: 'id required' };
          const board = loadBoard();
          const before = board.tasks.length;
          board.tasks = board.tasks.filter(t => t.id !== taskId);
          if (board.tasks.length === before) return { id, error: 'task not found' };
          saveBoard(board);
          broadcast({ event: 'board.update', data: {} });
          return { id, result: { deleted: true } };
        }

        case 'board.move': {
          const taskId = params?.id as string;
          const status = params?.status as string;
          if (!taskId || !status) return { id, error: 'id and status required' };
          const board = loadBoard();
          const task = board.tasks.find(t => t.id === taskId);
          if (!task) return { id, error: 'task not found' };
          task.status = status as BoardTask['status'];
          task.updatedAt = new Date().toISOString();
          if (status === 'done') task.completedAt = task.updatedAt;
          saveBoard(board);
          broadcast({ event: 'board.update', data: {} });
          return { id, result: task };
        }

        case 'heartbeat.status': {
          return {
            id,
            result: {
              enabled: config.heartbeat?.enabled ?? false,
              interval: config.heartbeat?.every || '30m',
              lastStatus: lastHeartbeatStatus,
            },
          };
        }

        case 'heartbeat.run': {
          if (!heartbeatRunner) return { id, error: 'heartbeat not enabled' };
          const hbResult = await heartbeatRunner.runNow('manual');
          return { id, result: hbResult };
        }

        case 'skills.list': {
          const userSkillsDir = resolve(join('~', '.dorabot', 'skills'));
          const allSkills = loadAllSkills(config);
          const result = allSkills.map(skill => ({
            name: skill.name,
            description: skill.description,
            path: skill.path,
            userInvocable: skill.userInvocable,
            metadata: skill.metadata,
            eligibility: checkSkillEligibility(skill, config),
            builtIn: !skill.path.startsWith(userSkillsDir),
          }));
          return { id, result };
        }

        case 'skills.read': {
          const name = params?.name as string;
          if (!name) return { id, error: 'name required' };
          const skill = findSkillByName(name, config);
          if (!skill) return { id, error: `skill not found: ${name}` };
          try {
            const raw = readFileSync(skill.path, 'utf-8');
            return { id, result: { name: skill.name, path: skill.path, raw } };
          } catch (err) {
            return { id, error: err instanceof Error ? err.message : String(err) };
          }
        }

        case 'skills.create': {
          const name = params?.name as string;
          const description = params?.description as string || '';
          const content = params?.content as string || '';
          const userInvocable = params?.userInvocable !== false;
          const metadata = params?.metadata as Record<string, unknown> | undefined;

          if (!name) return { id, error: 'name required' };
          if (/[\/\\]/.test(name)) return { id, error: 'name cannot contain slashes' };

          const skillDir = resolve(join('~', '.dorabot', 'skills', name));
          const skillPath = join(skillDir, 'SKILL.md');

          // build frontmatter
          const fm: Record<string, unknown> = { name, description };
          if (!userInvocable) fm['user-invocable'] = false;
          if (metadata?.requires) fm.metadata = { requires: metadata.requires };

          const yamlLines = ['---'];
          yamlLines.push(`name: ${fm.name}`);
          yamlLines.push(`description: "${(fm.description as string).replace(/"/g, '\\"')}"`);
          if (fm['user-invocable'] === false) yamlLines.push('user-invocable: false');
          if (fm.metadata) {
            const req = (fm.metadata as any).requires;
            if (req) {
              yamlLines.push('metadata:');
              yamlLines.push('  requires:');
              if (req.bins?.length) yamlLines.push(`    bins: [${req.bins.map((b: string) => `'${b}'`).join(', ')}]`);
              if (req.env?.length) yamlLines.push(`    env: [${req.env.map((e: string) => `'${e}'`).join(', ')}]`);
            }
          }
          yamlLines.push('---');
          yamlLines.push('');

          const fileContent = yamlLines.join('\n') + content;

          try {
            mkdirSync(skillDir, { recursive: true });
            writeFileSync(skillPath, fileContent, 'utf-8');
            return { id, result: { name, path: skillPath } };
          } catch (err) {
            return { id, error: err instanceof Error ? err.message : String(err) };
          }
        }

        case 'skills.delete': {
          const name = params?.name as string;
          if (!name) return { id, error: 'name required' };

          const skill = findSkillByName(name, config);
          if (!skill) return { id, error: `skill not found: ${name}` };

          const userSkillsDir = resolve(join('~', '.dorabot', 'skills'));
          if (!skill.path.startsWith(userSkillsDir)) {
            return { id, error: 'cannot delete built-in skills' };
          }

          try {
            const skillDir = resolve(join('~', '.dorabot', 'skills', name));
            rmSync(skillDir, { recursive: true, force: true });
            return { id, result: { deleted: name } };
          } catch (err) {
            return { id, error: err instanceof Error ? err.message : String(err) };
          }
        }

        // ── provider RPCs ─────────────────────────────────────────
        case 'provider.detect': {
          const [claudeInstalled, codexInstalled, claudeOAuth, codexAuth, apiKey] =
            await Promise.all([
              isClaudeInstalled(),
              isCodexInstalled(),
              Promise.resolve(hasOAuthTokens()),
              Promise.resolve(hasCodexAuth()),
              Promise.resolve(!!getClaudeApiKey()),
            ]);

          return { id, result: {
            claude: { installed: claudeInstalled, hasOAuth: claudeOAuth, hasApiKey: apiKey },
            codex: { installed: codexInstalled, hasAuth: codexAuth },
          }};
        }

        case 'provider.get': {
          try {
            const provider = await getProvider(config);
            const authStatus = await provider.getAuthStatus();
            return { id, result: { name: config.provider.name, auth: authStatus } };
          } catch (err) {
            return { id, error: err instanceof Error ? err.message : String(err) };
          }
        }

        case 'provider.set': {
          const name = params?.name as ProviderName;
          if (!name || !['claude', 'codex'].includes(name)) {
            return { id, error: 'name must be "claude" or "codex"' };
          }
          config.provider.name = name;
          saveConfig(config);
          broadcast({ event: 'config.update', data: { key: 'provider', value: config.provider } });
          return { id, result: { provider: name } };
        }

        case 'provider.auth.status': {
          try {
            const providerName = (params?.provider as string) || config.provider.name;
            const p = await getProviderByName(providerName);
            return { id, result: await p.getAuthStatus() };
          } catch (err) {
            return { id, error: err instanceof Error ? err.message : String(err) };
          }
        }

        case 'provider.auth.apiKey': {
          try {
            const providerName = (params?.provider as string) || config.provider.name;
            const apiKey = params?.apiKey as string;
            if (!apiKey) return { id, error: 'apiKey required' };
            const p = await getProviderByName(providerName);
            const status = await p.loginWithApiKey(apiKey);
            broadcast({ event: 'provider.auth_complete', data: { provider: providerName, status } });
            return { id, result: status };
          } catch (err) {
            return { id, error: err instanceof Error ? err.message : String(err) };
          }
        }

        case 'provider.auth.oauth': {
          try {
            const providerName = (params?.provider as string) || config.provider.name;
            const p = await getProviderByName(providerName);
            if (!p.loginWithOAuth) {
              return { id, error: `${providerName} doesn't support OAuth` };
            }
            const { authUrl, loginId } = await p.loginWithOAuth();
            broadcast({ event: 'provider.oauth_url', data: { provider: providerName, authUrl, loginId } });
            return { id, result: { authUrl, loginId } };
          } catch (err) {
            return { id, error: err instanceof Error ? err.message : String(err) };
          }
        }

        case 'provider.auth.oauth.complete': {
          try {
            const providerName = (params?.provider as string) || config.provider.name;
            const loginId = params?.loginId as string;
            const p = await getProviderByName(providerName);
            if (!p.completeOAuthLogin) {
              return { id, error: `${providerName} doesn't support OAuth` };
            }
            const status = await p.completeOAuthLogin(loginId);
            broadcast({ event: 'provider.auth_complete', data: { provider: providerName, status } });
            return { id, result: status };
          } catch (err) {
            return { id, error: err instanceof Error ? err.message : String(err) };
          }
        }

        case 'provider.check': {
          try {
            const providerName = (params?.provider as string) || config.provider.name;
            const p = await getProviderByName(providerName);
            return { id, result: await p.checkReady() };
          } catch (err) {
            return { id, error: err instanceof Error ? err.message : String(err) };
          }
        }

        // ── config RPCs ──────────────────────────────────────────
        case 'config.get': {
          const safe = structuredClone(config);
          if (safe.channels?.telegram) {
            delete (safe.channels.telegram as any).botToken;
          }
          return { id, result: safe };
        }

        case 'config.set': {
          const key = params?.key as string;
          const value = params?.value;
          if (!key) return { id, error: 'key required' };
          if (key === 'model' && typeof value === 'string') {
            config.model = value;
            saveConfig(config);
            broadcast({ event: 'config.update', data: { key, value } });
            return { id, result: { model: value } };
          }

          if (key === 'permissionMode' && typeof value === 'string') {
            const valid = ['default', 'acceptEdits', 'bypassPermissions', 'plan', 'dontAsk'];
            if (!valid.includes(value)) return { id, error: `permissionMode must be one of: ${valid.join(', ')}` };
            config.permissionMode = value as any;
            saveConfig(config);
            broadcast({ event: 'config.update', data: { key, value } });
            return { id, result: { key, value } };
          }

          if (key === 'systemPromptMode' && typeof value === 'string') {
            const valid = ['full', 'minimal', 'none'];
            if (!valid.includes(value)) return { id, error: `systemPromptMode must be one of: ${valid.join(', ')}` };
            config.systemPromptMode = value as any;
            saveConfig(config);
            broadcast({ event: 'config.update', data: { key, value } });
            return { id, result: { key, value } };
          }

          if (key === 'security.approvalMode' && typeof value === 'string') {
            const valid = ['approve-sensitive', 'autonomous', 'lockdown'];
            if (!valid.includes(value)) return { id, error: `approvalMode must be one of: ${valid.join(', ')}` };
            if (!config.security) config.security = {};
            config.security.approvalMode = value as any;
            saveConfig(config);
            broadcast({ event: 'config.update', data: { key, value } });
            return { id, result: { key, value } };
          }

          // provider config keys
          if (key === 'provider.name' && typeof value === 'string') {
            if (!['claude', 'codex'].includes(value)) {
              return { id, error: 'provider.name must be "claude" or "codex"' };
            }
            config.provider.name = value as ProviderName;
            saveConfig(config);
            broadcast({ event: 'config.update', data: { key, value } });
            return { id, result: { key, value } };
          }

          if (key === 'reasoningEffort') {
            const valid = ['minimal', 'low', 'medium', 'high', 'max', null];
            if (value !== null && !valid.includes(value as string)) {
              return { id, error: `reasoningEffort must be one of: ${valid.filter(Boolean).join(', ')} (or null to clear)` };
            }
            config.reasoningEffort = value as any;
            saveConfig(config);
            broadcast({ event: 'config.update', data: { key, value } });
            return { id, result: { key, value } };
          }

          if (key === 'provider.codex.model' && typeof value === 'string') {
            if (!config.provider.codex) config.provider.codex = {};
            config.provider.codex.model = value;
            saveConfig(config);
            broadcast({ event: 'config.update', data: { key, value } });
            return { id, result: { key, value } };
          }

          if (key === 'provider.codex.approvalPolicy' && typeof value === 'string') {
            const valid = ['never', 'on-request', 'on-failure', 'untrusted'];
            if (!valid.includes(value)) return { id, error: `approvalPolicy must be one of: ${valid.join(', ')}` };
            if (!config.provider.codex) config.provider.codex = {};
            config.provider.codex.approvalPolicy = value as any;
            saveConfig(config);
            broadcast({ event: 'config.update', data: { key, value } });
            return { id, result: { key, value } };
          }

          if (key === 'provider.codex.sandboxMode' && typeof value === 'string') {
            const valid = ['read-only', 'workspace-write', 'danger-full-access'];
            if (!valid.includes(value)) return { id, error: `sandboxMode must be one of: ${valid.join(', ')}` };
            if (!config.provider.codex) config.provider.codex = {};
            config.provider.codex.sandboxMode = value as any;
            saveConfig(config);
            broadcast({ event: 'config.update', data: { key, value } });
            return { id, result: { key, value } };
          }

          if (key === 'provider.codex.networkAccess' && typeof value === 'boolean') {
            if (!config.provider.codex) config.provider.codex = {};
            config.provider.codex.networkAccess = value;
            saveConfig(config);
            broadcast({ event: 'config.update', data: { key, value } });
            return { id, result: { key, value } };
          }

          if (key === 'provider.codex.webSearch' && typeof value === 'string') {
            const valid = ['disabled', 'cached', 'live'];
            if (!valid.includes(value)) return { id, error: `webSearch must be one of: ${valid.join(', ')}` };
            if (!config.provider.codex) config.provider.codex = {};
            config.provider.codex.webSearch = value as any;
            saveConfig(config);
            broadcast({ event: 'config.update', data: { key, value } });
            return { id, result: { key, value } };
          }

          if (key === 'browser.enabled' && typeof value === 'boolean') {
            if (!config.browser) config.browser = {};
            config.browser.enabled = value;
            saveConfig(config);
            broadcast({ event: 'config.update', data: { key, value } });
            return { id, result: { key, value } };
          }

          if (key === 'browser.headless' && typeof value === 'boolean') {
            if (!config.browser) config.browser = {};
            config.browser.headless = value;
            saveConfig(config);
            broadcast({ event: 'config.update', data: { key, value } });
            return { id, result: { key, value } };
          }

          // channel policy keys: channels.<channel>.dmPolicy / groupPolicy
          const policyMatch = key.match(/^channels\.(telegram|whatsapp)\.(dmPolicy|groupPolicy)$/);
          if (policyMatch) {
            const ch = policyMatch[1] as 'telegram' | 'whatsapp';
            const field = policyMatch[2] as 'dmPolicy' | 'groupPolicy';
            if (field === 'dmPolicy' && value !== 'open' && value !== 'allowlist') {
              return { id, error: 'dmPolicy must be open or allowlist' };
            }
            if (field === 'groupPolicy' && value !== 'open' && value !== 'allowlist' && value !== 'disabled') {
              return { id, error: 'groupPolicy must be open, allowlist, or disabled' };
            }
            if (!config.channels) config.channels = {};
            if (!config.channels[ch]) config.channels[ch] = {};
            (config.channels[ch] as any)[field] = value;
            saveConfig(config);
            return { id, result: { key, value } };
          }

          // sandbox settings
          const sandboxMatch = key.match(/^sandbox\.(mode|scope|workspaceAccess|enabled)$/);
          if (sandboxMatch) {
            const field = sandboxMatch[1];
            if (field === 'mode') {
              const valid = ['off', 'non-main', 'all'];
              if (!valid.includes(value as string)) return { id, error: `sandbox.mode must be one of: ${valid.join(', ')}` };
              config.sandbox.mode = value as any;
            } else if (field === 'scope') {
              const valid = ['session', 'agent', 'shared'];
              if (!valid.includes(value as string)) return { id, error: `sandbox.scope must be one of: ${valid.join(', ')}` };
              config.sandbox.scope = value as any;
            } else if (field === 'workspaceAccess') {
              const valid = ['none', 'ro', 'rw'];
              if (!valid.includes(value as string)) return { id, error: `sandbox.workspaceAccess must be one of: ${valid.join(', ')}` };
              config.sandbox.workspaceAccess = value as any;
            } else if (field === 'enabled') {
              config.sandbox.enabled = !!value;
            }
            saveConfig(config);
            broadcast({ event: 'config.update', data: { key, value } });
            return { id, result: { key, value } };
          }

          if (key === 'sandbox.network.enabled' && typeof value === 'boolean') {
            if (!config.sandbox.network) config.sandbox.network = {};
            config.sandbox.network.enabled = value;
            saveConfig(config);
            broadcast({ event: 'config.update', data: { key, value } });
            return { id, result: { key, value } };
          }

          return { id, error: `unsupported config key: ${key}` };
        }

        case 'fs.list': {
          const dirPath = params?.path as string;
          if (!dirPath) return { id, error: 'path required' };
          const resolved = resolve(dirPath);
          if (!isPathAllowed(resolved, config)) {
            return { id, error: `path not allowed: ${resolved}` };
          }
          try {
            const entries = readdirSync(resolved, { withFileTypes: true });
            const items = entries.map(e => ({
              name: e.name,
              type: (e.isDirectory() ? 'directory' : 'file') as 'directory' | 'file',
              size: e.isFile() ? (() => { try { return statSync(join(resolved, e.name)).size; } catch { return 0; } })() : undefined,
            }));
            items.sort((a, b) => {
              if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
              return a.name.localeCompare(b.name);
            });
            return { id, result: items };
          } catch (err) {
            return { id, error: err instanceof Error ? err.message : String(err) };
          }
        }

        case 'fs.read': {
          const filePath = params?.path as string;
          if (!filePath) return { id, error: 'path required' };
          const resolved = resolve(filePath);
          if (!isPathAllowed(resolved, config)) {
            return { id, error: `path not allowed: ${resolved}` };
          }
          try {
            const content = readFileSync(resolved, 'utf-8');
            return { id, result: { content, path: resolved } };
          } catch (err) {
            return { id, error: err instanceof Error ? err.message : String(err) };
          }
        }

        case 'fs.readBinary': {
          const filePath = params?.path as string;
          if (!filePath) return { id, error: 'path required' };
          const resolved = resolve(filePath);
          if (!isPathAllowed(resolved, config)) {
            return { id, error: `path not allowed: ${resolved}` };
          }
          try {
            const buffer = readFileSync(resolved);
            const base64 = buffer.toString('base64');
            return { id, result: { content: base64, path: resolved } };
          } catch (err) {
            return { id, error: err instanceof Error ? err.message : String(err) };
          }
        }

        case 'fs.write': {
          const filePath = params?.path as string;
          const content = params?.content as string;
          if (!filePath) return { id, error: 'path required' };
          if (typeof content !== 'string') return { id, error: 'content required' };
          const resolved = resolve(filePath);
          if (!isPathAllowed(resolved, config)) {
            return { id, error: `path not allowed: ${resolved}` };
          }
          try {
            writeFileSync(resolved, content, 'utf-8');
            return { id, result: { path: resolved } };
          } catch (err) {
            return { id, error: err instanceof Error ? err.message : String(err) };
          }
        }

        case 'fs.mkdir': {
          const dirPath = params?.path as string;
          if (!dirPath) return { id, error: 'path required' };
          const resolved = resolve(dirPath);
          if (!isPathAllowed(resolved, config)) {
            return { id, error: `path not allowed: ${resolved}` };
          }
          try {
            mkdirSync(resolved, { recursive: true });
            return { id, result: { created: resolved } };
          } catch (err) {
            return { id, error: err instanceof Error ? err.message : String(err) };
          }
        }

        case 'fs.delete': {
          const targetPath = params?.path as string;
          if (!targetPath) return { id, error: 'path required' };
          const resolved = resolve(targetPath);
          if (!isPathAllowed(resolved, config)) {
            return { id, error: `path not allowed: ${resolved}` };
          }
          try {
            rmSync(resolved, { recursive: true, force: true });
            return { id, result: { deleted: resolved } };
          } catch (err) {
            return { id, error: err instanceof Error ? err.message : String(err) };
          }
        }

        case 'fs.rename': {
          const oldPath = params?.oldPath as string;
          const newPath = params?.newPath as string;
          if (!oldPath || !newPath) return { id, error: 'oldPath and newPath required' };
          const resolvedOld = resolve(oldPath);
          const resolvedNew = resolve(newPath);
          if (!isPathAllowed(resolvedOld, config) || !isPathAllowed(resolvedNew, config)) {
            return { id, error: `path not allowed` };
          }
          try {
            renameSync(resolvedOld, resolvedNew);
            return { id, result: { oldPath: resolvedOld, newPath: resolvedNew } };
          } catch (err) {
            return { id, error: err instanceof Error ? err.message : String(err) };
          }
        }

        case 'fs.watch.start': {
          const watchPath = params?.path as string;
          if (!watchPath) return { id, error: 'path required' };
          const resolvedWatch = resolve(watchPath);
          if (!isPathAllowed(resolvedWatch, config)) {
            return { id, error: `path not allowed: ${resolvedWatch}` };
          }
          startWatching(watchPath);
          return { id, result: { watching: resolve(watchPath) } };
        }

        case 'fs.watch.stop': {
          const watchPath = params?.path as string;
          if (!watchPath) return { id, error: 'path required' };
          stopWatching(watchPath);
          return { id, result: { stopped: resolve(watchPath) } };
        }

        case 'tool.approve': {
          const requestId = params?.requestId as string;
          if (!requestId) return { id, error: 'requestId required' };
          const pending = pendingApprovals.get(requestId);
          if (!pending) return { id, error: 'no pending approval with that ID' };
          pendingApprovals.delete(requestId);
          if (pending.timeout) clearTimeout(pending.timeout);
          pending.resolve({ approved: true, modifiedInput: params?.modifiedInput as Record<string, unknown> });
          return { id, result: { approved: true } };
        }

        case 'tool.deny': {
          const requestId = params?.requestId as string;
          if (!requestId) return { id, error: 'requestId required' };
          const pending = pendingApprovals.get(requestId);
          if (!pending) return { id, error: 'no pending approval with that ID' };
          pendingApprovals.delete(requestId);
          if (pending.timeout) clearTimeout(pending.timeout);
          pending.resolve({ approved: false, reason: (params?.reason as string) || 'user denied' });
          return { id, result: { denied: true } };
        }

        case 'tool.pending': {
          const list = Array.from(pendingApprovals.entries()).map(([reqId, p]) => ({
            requestId: reqId,
            toolName: p.toolName,
            input: p.input,
          }));
          return { id, result: list };
        }

        case 'security.get': {
          return { id, result: {
            approvalMode: config.security?.approvalMode || 'approve-sensitive',
            allowedPaths: config.gateway?.allowedPaths || [homedir()],
            deniedPaths: config.gateway?.deniedPaths || [],
            telegramAllowFrom: config.channels?.telegram?.allowFrom || [],
            whatsappAllowFrom: config.channels?.whatsapp?.allowFrom || [],
          }};
        }

        case 'security.senders.list': {
          return { id, result: {
            telegram: config.channels?.telegram?.allowFrom || [],
            whatsapp: config.channels?.whatsapp?.allowFrom || [],
          }};
        }

        case 'security.senders.add': {
          const channel = params?.channel as string;
          const senderId = params?.senderId as string;
          if (!channel || !senderId) return { id, error: 'channel and senderId required' };
          if (channel === 'telegram') {
            if (!config.channels) config.channels = {};
            if (!config.channels.telegram) config.channels.telegram = {};
            if (!config.channels.telegram.allowFrom) config.channels.telegram.allowFrom = [];
            if (!config.channels.telegram.allowFrom.includes(senderId)) {
              config.channels.telegram.allowFrom.push(senderId);
              saveConfig(config);
            }
          } else if (channel === 'whatsapp') {
            if (!config.channels) config.channels = {};
            if (!config.channels.whatsapp) config.channels.whatsapp = {};
            if (!config.channels.whatsapp.allowFrom) config.channels.whatsapp.allowFrom = [];
            if (!config.channels.whatsapp.allowFrom.includes(senderId)) {
              config.channels.whatsapp.allowFrom.push(senderId);
              saveConfig(config);
            }
          } else {
            return { id, error: `unsupported channel: ${channel}` };
          }
          return { id, result: { added: senderId, channel } };
        }

        case 'security.senders.remove': {
          const channel = params?.channel as string;
          const senderId = params?.senderId as string;
          if (!channel || !senderId) return { id, error: 'channel and senderId required' };
          if (channel === 'telegram' && config.channels?.telegram?.allowFrom) {
            config.channels.telegram.allowFrom = config.channels.telegram.allowFrom.filter(s => s !== senderId);
            saveConfig(config);
          } else if (channel === 'whatsapp' && config.channels?.whatsapp?.allowFrom) {
            config.channels.whatsapp.allowFrom = config.channels.whatsapp.allowFrom.filter(s => s !== senderId);
            saveConfig(config);
          }
          return { id, result: { removed: senderId, channel } };
        }

        case 'security.tools.get': {
          return { id, result: {
            global: config.security?.tools || {},
            whatsapp: config.channels?.whatsapp?.tools || {},
            telegram: config.channels?.telegram?.tools || {},
          }};
        }

        case 'security.tools.set': {
          const target = params?.target as string;  // 'global' | 'whatsapp' | 'telegram'
          const allow = params?.allow as string[] | undefined;
          const deny = params?.deny as string[] | undefined;
          if (!target) return { id, error: 'target required (global, whatsapp, telegram)' };

          const policy: ToolPolicyConfig = {};
          if (allow !== undefined) policy.allow = allow;
          if (deny !== undefined) policy.deny = deny;

          if (target === 'global') {
            if (!config.security) config.security = {};
            config.security.tools = policy;
          } else if (target === 'whatsapp') {
            if (!config.channels) config.channels = {};
            if (!config.channels.whatsapp) config.channels.whatsapp = {};
            config.channels.whatsapp.tools = policy;
          } else if (target === 'telegram') {
            if (!config.channels) config.channels = {};
            if (!config.channels.telegram) config.channels.telegram = {};
            config.channels.telegram.tools = policy;
          } else {
            return { id, error: `unsupported target: ${target}` };
          }
          saveConfig(config);
          broadcast({ event: 'config.update', data: { key: `security.tools.${target}`, value: policy } });
          return { id, result: { target, policy } };
        }

        case 'security.paths.get': {
          return { id, result: {
            global: {
              allowed: config.gateway?.allowedPaths || [homedir(), '/tmp'],
              denied: config.gateway?.deniedPaths || [],
              alwaysDenied: ALWAYS_DENIED,
            },
            whatsapp: {
              allowed: config.channels?.whatsapp?.allowedPaths || [],
              denied: config.channels?.whatsapp?.deniedPaths || [],
            },
            telegram: {
              allowed: config.channels?.telegram?.allowedPaths || [],
              denied: config.channels?.telegram?.deniedPaths || [],
            },
          }};
        }

        case 'security.paths.set': {
          const target = params?.target as string;
          const allowed = params?.allowed as string[] | undefined;
          const denied = params?.denied as string[] | undefined;
          if (!target) return { id, error: 'target required (global, whatsapp, telegram)' };

          if (target === 'global') {
            if (!config.gateway) config.gateway = {};
            if (allowed !== undefined) config.gateway.allowedPaths = allowed;
            if (denied !== undefined) config.gateway.deniedPaths = denied;
          } else if (target === 'whatsapp') {
            if (!config.channels) config.channels = {};
            if (!config.channels.whatsapp) config.channels.whatsapp = {};
            if (allowed !== undefined) config.channels.whatsapp.allowedPaths = allowed;
            if (denied !== undefined) config.channels.whatsapp.deniedPaths = denied;
          } else if (target === 'telegram') {
            if (!config.channels) config.channels = {};
            if (!config.channels.telegram) config.channels.telegram = {};
            if (allowed !== undefined) config.channels.telegram.allowedPaths = allowed;
            if (denied !== undefined) config.channels.telegram.deniedPaths = denied;
          } else {
            return { id, error: `unsupported target: ${target}` };
          }
          saveConfig(config);
          broadcast({ event: 'config.update', data: { key: `security.paths.${target}`, value: { allowed, denied } } });
          return { id, result: { target, allowed, denied } };
        }

        case 'agent.run_background': {
          const prompt = params?.prompt as string;
          if (!prompt) return { id, error: 'prompt required' };

          const bgId = randomUUID();
          const sessionKey = `bg:${bgId}`;
          const bgRun: BackgroundRun = {
            id: bgId, sessionKey, prompt,
            startedAt: Date.now(), status: 'running',
          };
          backgroundRuns.set(bgId, bgRun);
          broadcast({ event: 'background.status', data: bgRun });

          // fire and forget — runs on its own session key
          handleAgentRun({ prompt, sessionKey, source: 'desktop/background' }).then(result => {
            bgRun.status = 'completed';
            bgRun.result = result?.result;
            broadcast({ event: 'background.status', data: bgRun });
          }).catch(err => {
            bgRun.status = 'error';
            bgRun.error = err instanceof Error ? err.message : String(err);
            broadcast({ event: 'background.status', data: bgRun });
          });

          return { id, result: { backgroundRunId: bgId, sessionKey } };
        }

        case 'agent.background_runs': {
          return { id, result: Array.from(backgroundRuns.values()) };
        }

        default:
          return { id, error: `unknown method: ${method}` };
      }
    } catch (err) {
      return { id, error: err instanceof Error ? err.message : String(err) };
    }
  }

  // ── TLS setup ───────────────────────────────────────────────
  const useTls = config.gateway?.tls !== false;
  const tlsDir = join(homedir(), '.dorabot', 'tls');
  const certPath = join(tlsDir, 'cert.pem');
  const keyPath = join(tlsDir, 'key.pem');

  if (useTls && (!existsSync(certPath) || !existsSync(keyPath))) {
    console.log('[gateway] generating self-signed TLS certificate...');
    mkdirSync(tlsDir, { recursive: true });
    execSync(
      `openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 ` +
      `-keyout "${keyPath}" -out "${certPath}" -days 3650 -nodes ` +
      `-subj "/CN=dorabot-gateway" ` +
      `-addext "subjectAltName=DNS:localhost,IP:127.0.0.1"`,
      { stdio: 'ignore' },
    );
    chmodSync(keyPath, 0o600);
    chmodSync(certPath, 0o600);
    console.log(`[gateway] TLS cert created at ${tlsDir}`);
  }

  // ── HTTP/HTTPS server ──────────────────────────────────────
  const requestHandler = (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', uptime: Date.now() - startedAt, tls: useTls }));
      return;
    }
    res.writeHead(404);
    res.end();
  };

  const httpServer = useTls
    ? createTlsServer({ cert: readFileSync(certPath), key: readFileSync(keyPath) }, requestHandler)
    : createServer(requestHandler);

  // ── WebSocket origin validation ────────────────────────────
  const allowedOrigins = new Set([
    'http://localhost:5173',  // vite dev
    'https://localhost:5173',
    'file://',                // production Electron
    ...(config.gateway?.allowedOrigins || []),
  ]);

  const wss = new WebSocketServer({
    server: httpServer,
    verifyClient: ({ req }: { req: import('node:http').IncomingMessage }) => {
      const origin = req.headers.origin;
      // no origin = non-browser client (Node WS, Electron, CLI) — allow
      if (!origin) return true;
      if (allowedOrigins.has(origin)) return true;
      console.log(`[gateway] rejected WS connection from origin: ${origin}`);
      return false;
    },
  });

  wss.on('connection', (ws) => {
    clients.set(ws, { authenticated: false });
    console.log(`[gateway] client connected (${clients.size} total)`);

    // auth timeout
    setTimeout(() => {
      const state = clients.get(ws);
      if (state && !state.authenticated) {
        console.log('[gateway] auth timeout, closing connection');
        ws.close();
      }
    }, 5000);

    ws.on('message', async (raw) => {
      let msg: WsMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        ws.send(JSON.stringify({ error: 'invalid json' }));
        return;
      }

      if (!msg.method) {
        ws.send(JSON.stringify({ error: 'method required' }));
        return;
      }

      // auth check
      const clientState = clients.get(ws);
      if (!clientState?.authenticated) {
        if (msg.method === 'auth') {
          const token = (msg.params as any)?.token as string;
          if (token === gatewayToken) {
            clientState!.authenticated = true;
            console.log(`[gateway] client authenticated (${Array.from(clients.values()).filter(c => c.authenticated).length} authenticated)`);
            ws.send(JSON.stringify({
              event: 'status.update',
              data: {
                running: true,
                startedAt,
                channels: channelManager.getStatuses(),
                sessions: sessionRegistry.list(),
              },
            }));
            ws.send(JSON.stringify({ id: msg.id, result: { authenticated: true } }));
          } else {
            ws.send(JSON.stringify({ id: msg.id, error: 'invalid token' }));
            ws.close();
          }
          return;
        }
        ws.send(JSON.stringify({ id: msg.id, error: 'not authenticated' }));
        return;
      }

      const response = await handleRpc(msg);
      ws.send(JSON.stringify(response));
    });

    ws.on('close', () => {
      clients.delete(ws);
      console.log(`[gateway] client disconnected (${clients.size} total)`);
    });

    ws.on('error', (err) => {
      console.error('[gateway] ws error:', err.message);
      clients.delete(ws);
    });
  });

  await new Promise<void>((resolve) => {
    httpServer.listen(port, host, () => {
      console.log(`[gateway] listening on ${useTls ? 'wss' : 'ws'}://${host}:${port}`);
      resolve();
    });
  });

  // start channels
  await channelManager.startAll();

  return {
    close: async () => {
      heartbeatRunner?.stop();
      cronRunner?.stop();
      await channelManager.stopAll();
      await disposeAllProviders();

      // close all file watchers
      for (const [path, { watcher }] of fileWatchers) {
        watcher.close();
        console.log(`[gateway] closed watcher: ${path}`);
      }
      fileWatchers.clear();

      for (const [ws] of clients) {
        ws.close();
      }
      clients.clear();

      await new Promise<void>((resolve) => {
        wss.close(() => {
          httpServer.close(() => resolve());
        });
      });
    },
    broadcast,
    sessionRegistry,
    channelManager,
    heartbeatRunner,
    cronRunner,
    context,
  };
}
