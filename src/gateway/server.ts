import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'node:http';
import { createServer as createTlsServer } from 'node:https';
import { readdirSync, statSync, readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, renameSync, chmodSync, unlinkSync, watch, type FSWatcher } from 'node:fs';
import { writeFile } from 'node:fs/promises';
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
import { startScheduler, loadCalendarItems, migrateCronToCalendar, type SchedulerRunner } from '../calendar/scheduler.js';
import { checkSkillEligibility, loadAllSkills, findSkillByName } from '../skills/loader.js';
import type { InboundMessage } from '../channels/types.js';
import { getAllChannelStatuses } from '../channels/index.js';
import { loginWhatsApp, logoutWhatsApp, isWhatsAppLinked } from '../channels/whatsapp/login.js';
import { getDefaultAuthDir } from '../channels/whatsapp/session.js';
import { validateTelegramToken } from '../channels/telegram/bot.js';
import { insertEvent, queryEvents, cleanupOldEvents } from './event-log.js';
import { getChannelHandler } from '../tools/messaging.js';
import { setScheduler } from '../tools/index.js';
import { loadGoals, saveGoals, type GoalTask } from '../tools/goals.js';
import { loadResearch, saveResearch, readResearchContent, type ResearchItem } from '../tools/research.js';
import { getProvider, getProviderByName, disposeAllProviders } from '../providers/index.js';
import { isClaudeInstalled, hasOAuthTokens, getApiKey as getClaudeApiKey, getActiveAuthMethod, isOAuthTokenExpired } from '../providers/claude.js';
import { isCodexInstalled, hasCodexAuth } from '../providers/codex.js';
import type { ProviderName } from '../config.js';
import { randomUUID, randomBytes } from 'node:crypto';
import { classifyToolCall, cleanToolName, isToolAllowed, type Tier } from './tool-policy.js';
import { AUTONOMOUS_SCHEDULE_ID, buildAutonomousCalendarItem, PULSE_INTERVALS, DEFAULT_PULSE_INTERVAL, pulseIntervalToRrule, rruleToPulseInterval } from '../autonomous.js';

const DEFAULT_PORT = 18789;
const DEFAULT_HOST = '127.0.0.1';

function macNotify(title: string, body: string) {
  try {
    const t = title.replace(/"/g, '\\"');
    const b = body.replace(/"/g, '\\"');
    execSync(`osascript -e 'display notification "${b}" with title "${t}"'`, { stdio: 'ignore' });
  } catch { /* ignore */ }
}

// ── Tool status display maps ──────────────────────────────────────────
// Used to build the live status message shown on Telegram/WhatsApp while the agent works.
// Output is markdown that gets converted to HTML by markdownToTelegramHtml().

const TOOL_EMOJI: Record<string, string> = {
  Read: '📄', Write: '📝', Edit: '✏️',
  Glob: '📂', Grep: '🔍', Bash: '⚡',
  WebFetch: '🌐', WebSearch: '🔎', Task: '🤖',
  AskUserQuestion: '💬', TodoWrite: '📋',
  NotebookEdit: '📓', message: '💬',
  screenshot: '📸', browser: '🌐',
  schedule: '⏰', list_schedule: '⏰',
  update_schedule: '⏰', cancel_schedule: '⏰',
  goals_view: '🎯', goals_add: '🎯', goals_update: '🎯', goals_propose: '🎯',
};

const TOOL_LABEL: Record<string, string> = {
  Read: 'Read', Write: 'Wrote', Edit: 'Edited',
  Glob: 'Searched files', Grep: 'Searched', Bash: 'Ran',
  WebFetch: 'Fetched', WebSearch: 'Searched web', Task: 'Ran task',
  AskUserQuestion: 'Asked a question', TodoWrite: 'Updated tasks',
  NotebookEdit: 'Edited notebook', message: 'Replied',
  screenshot: 'Took screenshot', browser: 'Browsed',
  schedule: 'Scheduled', list_schedule: 'Listed schedule',
  update_schedule: 'Updated schedule', cancel_schedule: 'Cancelled schedule',
  goals_view: 'Checked goals', goals_add: 'Added goal', goals_update: 'Updated goal', goals_propose: 'Proposed goal',
};

const TOOL_ACTIVE_LABEL: Record<string, string> = {
  Read: 'Reading', Write: 'Writing', Edit: 'Editing',
  Glob: 'Searching files', Grep: 'Searching', Bash: 'Running',
  WebFetch: 'Fetching', WebSearch: 'Searching web', Task: 'Running task',
  AskUserQuestion: 'Asking', TodoWrite: 'Updating tasks',
  NotebookEdit: 'Editing notebook', message: 'Replying',
  screenshot: 'Taking screenshot', browser: 'Browsing',
  schedule: 'Scheduling', list_schedule: 'Listing schedule',
  update_schedule: 'Updating schedule', cancel_schedule: 'Cancelling schedule',
  goals_view: 'Checking goals', goals_add: 'Adding goal', goals_update: 'Updating goal', goals_propose: 'Proposing goal',
};

// Plural labels when multiple consecutive same-tool calls are grouped
const TOOL_PLURAL: Record<string, (n: number) => string> = {
  Read: (n) => `Read ${n} files`,
  Write: (n) => `Wrote ${n} files`,
  Edit: (n) => `Edited ${n} files`,
  Grep: (n) => `Ran ${n} searches`,
  Bash: (n) => `Ran ${n} commands`,
  Task: (n) => `Ran ${n} sub-tasks`,
  WebFetch: (n) => `Fetched ${n} pages`,
  WebSearch: (n) => `Ran ${n} web searches`,
  browser: (n) => `Performed ${n} browser actions`,
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
    case 'Bash': return String(input.command || '').split('\n')[0].slice(0, 50);
    case 'WebFetch': {
      try { return new URL(String(input.url || '')).hostname; } catch { return ''; }
    }
    case 'WebSearch': return String(input.query || '').slice(0, 40);
    case 'Task': return String(input.description || '').slice(0, 40);
    case 'message': return '';
    case 'browser': return String(input.action || '');
    case 'screenshot': return '';
    default: return '';
  }
}

type ToolEntry = { name: string; detail: string };
type ToolGroup = { name: string; entries: ToolEntry[] };

/** Group consecutive tools with the same name */
function groupConsecutiveTools(entries: ToolEntry[]): ToolGroup[] {
  const groups: ToolGroup[] = [];
  for (const entry of entries) {
    const last = groups[groups.length - 1];
    if (last && last.name === entry.name) {
      last.entries.push(entry);
    } else {
      groups.push({ name: entry.name, entries: [entry] });
    }
  }
  return groups;
}

/** Wrap detail text in backticks for inline code rendering, stripping any existing backticks */
function fmtDetail(detail: string): string {
  if (!detail) return '';
  const clean = detail.replace(/`/g, "'");
  return ` \`${clean}\``;
}

/** Format a group of completed tool calls into a single status line */
function formatCompletedGroup(g: ToolGroup): string {
  const emoji = TOOL_EMOJI[g.name] || '✓';

  if (g.name === 'message') return `✓ 💬 Replied`;

  if (g.entries.length === 1) {
    const label = TOOL_LABEL[g.name] || g.name;
    return `✓ ${emoji} ${label}${fmtDetail(g.entries[0].detail)}`;
  }

  // Multiple consecutive calls — use plural summary
  const count = g.entries.length;
  const pluralFn = TOOL_PLURAL[g.name];
  const text = pluralFn ? pluralFn(count) : `${TOOL_LABEL[g.name] || g.name} ×${count}`;
  return `✓ ${emoji} ${text}`;
}

/**
 * Build a user-friendly status message shown on channels while the agent works.
 *
 * Features:
 * - Groups consecutive same-tool calls (e.g. "Read 3 files" instead of 3 lines)
 * - Collapses older steps when there are many ("...5 earlier steps")
 * - Uses markdown formatting: `code` for file paths/commands, _italic_ for collapsed hint
 * - Separates completed steps from the active step visually
 */
function buildToolStatusText(completed: ToolEntry[], current: ToolEntry | null): string {
  const lines: string[] = [];

  const groups = groupConsecutiveTools(completed);

  // Collapse older groups if there are many — keep last 4 visible
  const MAX_VISIBLE = 4;
  let visibleGroups = groups;
  let hiddenSteps = 0;

  if (groups.length > MAX_VISIBLE) {
    const hidden = groups.slice(0, groups.length - MAX_VISIBLE);
    hiddenSteps = hidden.reduce((sum, g) => sum + g.entries.length, 0);
    visibleGroups = groups.slice(groups.length - MAX_VISIBLE);
  }

  if (hiddenSteps > 0) {
    lines.push(`_...${hiddenSteps} earlier step${hiddenSteps === 1 ? '' : 's'}_`);
  }

  for (const g of visibleGroups) {
    lines.push(formatCompletedGroup(g));
  }

  if (current) {
    // Visual separator between completed and active
    if (lines.length > 0) lines.push('');

    if (current.name === 'message') {
      lines.push(`⏳ 💬 Replying...`);
    } else {
      const emoji = TOOL_EMOJI[current.name] || '⏳';
      const label = TOOL_ACTIVE_LABEL[current.name] || current.name;
      lines.push(`⏳ ${emoji} ${label}${fmtDetail(current.detail)}...`);
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
  scheduler: SchedulerRunner | null;
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

  type ClientState = {
    authenticated: boolean;
    subscriptions: Set<string>;
    stale: Set<string>;
  };
  const clients = new Map<WebSocket, ClientState>();

  // live session snapshots for instant hydration on subscribe
  const sessionSnapshots = new Map<string, import('./types.js').SessionSnapshot>();

  // stream event batching: accumulate agent.stream per client, flush every 16ms
  const streamBatches = new Map<WebSocket, { events: string[]; timer: ReturnType<typeof setTimeout> | null }>();

  function queueStreamEvent(ws: WebSocket, serialized: string): void {
    let batch = streamBatches.get(ws);
    if (!batch) {
      batch = { events: [], timer: null };
      streamBatches.set(ws, batch);
    }
    batch.events.push(serialized);

    if (!batch.timer) {
      batch.timer = setTimeout(() => {
        if (batch!.events.length === 1) {
          ws.send(batch!.events[0]);
        } else {
          ws.send(JSON.stringify({ event: 'agent.stream_batch', data: batch!.events.map(e => JSON.parse(e)) }));
        }
        batch!.events = [];
        batch!.timer = null;
      }, 16);
    }
  }

  // backpressure recovery: periodically send snapshots to stale clients
  const backpressureTimer = setInterval(() => {
    for (const [ws, state] of clients) {
      if (!state.stale.size) continue;
      if (ws.bufferedAmount < 16384) {
        for (const sk of state.stale) {
          const snap = sessionSnapshots.get(sk);
          if (snap) ws.send(JSON.stringify({ event: 'session.snapshot', data: snap }));
        }
        state.stale.clear();
      }
    }
  }, 500);
  backpressureTimer.unref?.();
  const eventCleanupTimer = setInterval(() => cleanupOldEvents(), 5 * 60 * 1000);
  eventCleanupTimer.unref?.();

  const broadcast = (event: WsEvent): void => {
    const sk = (event.data as any)?.sessionKey as string | undefined;

    // persist agent events to SQLite for cursor-based replay on reconnect
    if (sk && typeof event.event === 'string' && event.event.startsWith('agent.') && event.event !== 'agent.error') {
      event.seq = insertEvent(sk, event.event, JSON.stringify(event.data));
    }

    const data = JSON.stringify(event);
    for (const [ws, state] of clients) {
      if (ws.readyState !== WebSocket.OPEN || !state.authenticated) continue;
      // session-scoped events only go to subscribers; global events go to all
      if (sk && !state.subscriptions.has(sk)) continue;
      // backpressure: if client is falling behind on stream deltas, skip
      if (sk && event.event === 'agent.stream' && ws.bufferedAmount > 65536) {
        state.stale.add(sk);
        continue;
      }
      // batch agent.stream events, send everything else immediately
      if (event.event === 'agent.stream') {
        queueStreamEvent(ws, data);
      } else {
        ws.send(data);
      }
    }
  };

  function broadcastStatus(sessionKey: string, status: string, toolName?: string, toolDetail?: string) {
    broadcast({
      event: 'agent.status',
      data: { sessionKey, status, toolName, toolDetail, timestamp: Date.now() },
    });
  }

  // file system watcher manager
  type FileWatchEntry = {
    watcher: FSWatcher;
    refCount: number;
    debounceTimer?: ReturnType<typeof setTimeout>;
    pendingEvent?: { eventType: string; filename: string | null };
  };
  const fileWatchers = new Map<string, FileWatchEntry>();
  const watchedPathsByClient = new Map<WebSocket, Set<string>>();
  const FS_WATCH_DEBOUNCE_MS = 250;
  const DEBUG_FS_WATCH = process.env.DORABOT_DEBUG_FS_WATCH === '1';

  const emitFsWatchEvent = (resolved: string) => {
    const entry = fileWatchers.get(resolved);
    if (!entry) return;
    entry.debounceTimer = undefined;
    const pending = entry.pendingEvent;
    entry.pendingEvent = undefined;
    if (!pending) return;
    broadcast({
      event: 'fs.change',
      data: { path: resolved, eventType: pending.eventType, filename: pending.filename, timestamp: Date.now() },
    });
  };

  const startWatching = (path: string) => {
    const resolved = resolve(path);
    const existing = fileWatchers.get(resolved);

    if (existing) {
      existing.refCount++;
      return;
    }

    try {
      const watcher = watch(resolved, { recursive: false }, (eventType, filename) => {
        const entry = fileWatchers.get(resolved);
        if (!entry) return;
        const filenameStr = filename ? String(filename) : null;
        if (DEBUG_FS_WATCH) {
          console.log(`[gateway] fs.watch: ${eventType} in ${resolved}${filenameStr ? '/' + filenameStr : ''}`);
        }
        entry.pendingEvent = { eventType, filename: filenameStr };
        if (entry.debounceTimer) return;
        entry.debounceTimer = setTimeout(() => emitFsWatchEvent(resolved), FS_WATCH_DEBOUNCE_MS);
        entry.debounceTimer.unref?.();
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
      if (existing.debounceTimer) clearTimeout(existing.debounceTimer);
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
  const ownerChatIdsFile = join(homedir(), '.dorabot', 'owner-chat-ids.json');
  const ownerChatIds = new Map<string, string>();

  // load persisted owner chat IDs from disk
  try {
    if (existsSync(ownerChatIdsFile)) {
      const saved = JSON.parse(readFileSync(ownerChatIdsFile, 'utf-8'));
      for (const [ch, id] of Object.entries(saved)) {
        if (typeof id === 'string') ownerChatIds.set(ch, id);
      }
    }
  } catch {}

  // seed from config allowFrom[0] for channels that aren't already known
  if (config.channels?.whatsapp?.enabled && config.channels.whatsapp.allowFrom?.[0] && !ownerChatIds.has('whatsapp')) {
    ownerChatIds.set('whatsapp', config.channels.whatsapp.allowFrom[0] + '@s.whatsapp.net');
  }
  if (config.channels?.telegram?.enabled && config.channels.telegram.allowFrom?.[0] && !ownerChatIds.has('telegram')) {
    ownerChatIds.set('telegram', config.channels.telegram.allowFrom[0]);
  }

  let ownerChatIdsDirty = false;
  function persistOwnerChatIds() {
    if (ownerChatIdsDirty) return;
    ownerChatIdsDirty = true;
    setTimeout(() => {
      ownerChatIdsDirty = false;
      const obj = Object.fromEntries(ownerChatIds);
      writeFile(ownerChatIdsFile, JSON.stringify(obj, null, 2)).catch(() => {});
    }, 1000);
  }
  // queued messages for sessions with active runs
  const pendingMessages = new Map<string, InboundMessage[]>();
  // accumulated tool log per active run
  const toolLogs = new Map<string, { completed: ToolEntry[]; current: { name: string; inputJson: string; detail: string } | null; lastEditAt: number }>();
  // active RunHandles for message injection into running agent sessions
  const runHandles = new Map<string, RunHandle>();
  type PulseReplyRef = {
    pulseSessionId: string;
    source: string;
    sentAt: number;
    messagePreview: string;
  };
  const pulseReplyRefs = new Map<string, PulseReplyRef>();
  const MAX_PULSE_REPLY_REFS = 2000;
  // clean up stale stream events from previous crashes
  cleanupOldEvents();

  // per-session channel context so the stream loop can manage status messages
  type ChannelRunContext = {
    channel: string;
    chatId: string;
    statusMsgId?: string;
    typingInterval?: ReturnType<typeof setInterval>;
  };
  const channelRunContexts = new Map<string, ChannelRunContext>();

  // background runs state
  type BackgroundRun = {
    id: string; sessionKey: string; prompt: string;
    startedAt: number; status: 'running' | 'completed' | 'error';
    result?: string; error?: string;
  };
  const backgroundRuns = new Map<string, BackgroundRun>();

  // guard against overlapping WhatsApp login attempts
  let whatsappLoginInProgress = false;

  // pending OAuth re-auth: when a 401 hits mid-run, we send the OAuth URL to the
  // user's channel and wait for them to paste the code back
  type PendingReauth = {
    prompt: string;
    sessionKey: string;
    source: string;
    channel: string;
    chatId: string;
    messageMetadata?: import('../session/manager.js').MessageMetadata;
  };
  const pendingReauths = new Map<string, PendingReauth>(); // keyed by chatId

  function pulseRefKey(channel: string, chatId: string, messageId: string): string {
    return `${channel}:${chatId}:${messageId}`;
  }

  function clampPreview(text: string, max = 500): string {
    return text.replace(/\s+/g, ' ').trim().slice(0, max);
  }

  function appendPulseSessionMarker(
    text: string,
    source: string,
    sessionKey: string,
    channel?: string,
  ): string {
    if (!text.trim()) return text;
    if (source !== `calendar/${AUTONOMOUS_SCHEDULE_ID}`) return text;
    if (channel && channel !== 'telegram') return text;
    if (/pulse_session_id:\s+/i.test(text)) return text;
    const sessionId = sessionRegistry.get(sessionKey)?.sessionId;
    if (!sessionId) return text;
    return `${text}\n\npulse_session_id: ${sessionId}`;
  }

  function registerPulseReplyRef(
    source: string,
    sessionKey: string,
    channel: string,
    chatId: string,
    messageId: string,
    messageText: string,
  ): void {
    if (source !== `calendar/${AUTONOMOUS_SCHEDULE_ID}`) return;
    const pulseSessionId = sessionRegistry.get(sessionKey)?.sessionId;
    if (!pulseSessionId) return;

    const key = pulseRefKey(channel, chatId, messageId);
    pulseReplyRefs.set(key, {
      pulseSessionId,
      source,
      sentAt: Date.now(),
      messagePreview: clampPreview(messageText),
    });

    if (pulseReplyRefs.size <= MAX_PULSE_REPLY_REFS) return;
    let oldestKey: string | null = null;
    let oldestTs = Number.POSITIVE_INFINITY;
    for (const [k, v] of pulseReplyRefs) {
      if (v.sentAt < oldestTs) {
        oldestTs = v.sentAt;
        oldestKey = k;
      }
    }
    if (oldestKey) pulseReplyRefs.delete(oldestKey);
  }

  function buildPulseReplyContext(msg: InboundMessage): string | undefined {
    const inlineSessionId =
      msg.body.match(/\bpulse_session_id:\s*([A-Za-z0-9._:-]+)/i)?.[1]
      || msg.replyToBody?.match(/\bpulse_session_id:\s*([A-Za-z0-9._:-]+)/i)?.[1];
    if (inlineSessionId) {
      return [
        'User referenced a prior autonomy pulse.',
        `Pulse session_id: ${inlineSessionId}`,
        'Use memory_read with this session_id to recover full pulse context before responding.',
      ].join('\n');
    }

    if (!msg.replyToId) return undefined;
    const ref = pulseReplyRefs.get(pulseRefKey(msg.channel, msg.chatId, msg.replyToId));
    if (!ref) return undefined;
    return [
      'User replied to an autonomy pulse message.',
      `Pulse source: ${ref.source}`,
      `Pulse session_id: ${ref.pulseSessionId}`,
      `Sent at: ${new Date(ref.sentAt).toISOString()}`,
      `Pulse message preview: ${ref.messagePreview || '(no preview)'}`,
      'Use memory_read with this session_id to recover full pulse context before responding.',
    ].join('\n');
  }

  // broadcast session.update so sidebar can show new/updated sessions + running state
  function broadcastSessionUpdate(sessionKey: string) {
    const reg = sessionRegistry.get(sessionKey);
    if (!reg) return;
    const meta = fileSessionManager.getMetadata(reg.sessionId);
    broadcast({
      event: 'session.update',
      data: {
        id: reg.sessionId,
        channel: reg.channel,
        chatId: reg.chatId,
        chatType: reg.chatType,
        senderName: meta?.senderName,
        messageCount: reg.messageCount,
        activeRun: reg.activeRun,
        updatedAt: new Date().toISOString(),
      },
    });
  }

  // set up channel status message + typing for a session key
  function setupChannelStatus(sessionKey: string, channel: string, chatId: string) {
    const handler = getChannelHandler(channel);
    if (!handler) return;

    const ctx: ChannelRunContext = { channel, chatId };
    channelRunContexts.set(sessionKey, ctx);

    (async () => {
      try {
        if (handler.typing) handler.typing(chatId).catch(() => {});
        const sent = await handler.send(chatId, 'thinking...');
        // check if ctx was already cleaned up while we were awaiting
        if (!channelRunContexts.has(sessionKey)) return;
        ctx.statusMsgId = sent.id;
        statusMessages.set(sessionKey, { channel, chatId, messageId: sent.id });
      } catch {}
      // bail if cleaned up during await
      if (!channelRunContexts.has(sessionKey)) return;
      if (handler.typing) {
        ctx.typingInterval = setInterval(() => {
          handler.typing!(chatId).catch(() => {});
        }, 4500);
      }
    })();
  }

  function isAuthError(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err);
    return /authentication_error|401|OAuth token has expired|Invalid bearer token/i.test(msg);
  }

  // OAuth codes are long base64/hex strings, optionally with #state suffix
  function looksLikeOAuthCode(text: string): boolean {
    return /^[A-Za-z0-9_\-+=/.]{20,}(#[A-Za-z0-9_\-+=/.]+)?$/.test(text.trim());
  }

  async function startReauthFlow(params: {
    prompt: string; sessionKey: string; source: string;
    channel?: string; chatId?: string;
    messageMetadata?: import('../session/manager.js').MessageMetadata;
  }): Promise<void> {
    const provider = await getProviderByName('claude');
    if (!provider.loginWithOAuth) return;

    const { authUrl } = await provider.loginWithOAuth();

    // broadcast to desktop regardless — it can show an inline re-auth UI
    broadcast({ event: 'auth.reauth_required', data: {
      channel: params.channel, chatId: params.chatId, authUrl,
    } });

    // if this came from a channel, send the link there and save context for replay
    const channel = params.channel;
    const chatId = params.chatId || params.messageMetadata?.chatId;
    if (channel && chatId) {
      const handler = getChannelHandler(channel);
      if (handler) {
        pendingReauths.set(chatId, {
          prompt: params.prompt,
          sessionKey: params.sessionKey,
          source: params.source,
          channel,
          chatId,
          messageMetadata: params.messageMetadata,
        });
        await handler.send(chatId, [
          'Auth token expired. Please re-authenticate:',
          '',
          authUrl,
          '',
          'Open the link, click Authorize, then paste the code here.',
        ].join('\n'));
      }
    }
  }

  function clearTypingInterval(ctx: ChannelRunContext) {
    if (ctx.typingInterval) {
      clearInterval(ctx.typingInterval);
      ctx.typingInterval = undefined;
    }
  }

  // process a channel message (or batched messages) through the agent
  async function processChannelMessage(msg: InboundMessage, batchedBodies?: string[], pulseReplyContext?: string) {
    ownerChatIds.set(msg.channel, msg.chatId);
    persistOwnerChatIds();

    // intercept OAuth re-auth code if we're waiting for one
    const pendingReauth = pendingReauths.get(msg.chatId);
    if (pendingReauth) {
      const code = (msg.body || '').trim();
      // if it doesn't look like an OAuth code, treat as a normal message
      // (user might be chatting while re-auth is pending)
      if (code && looksLikeOAuthCode(code)) {
        const handler = getChannelHandler(msg.channel);
        try {
          const provider = await getProviderByName('claude');
          if (!provider.completeOAuthLogin) throw new Error('provider missing completeOAuthLogin');
          const status = await provider.completeOAuthLogin(code);
          if (!status.authenticated) {
            // keep pendingReauth so user can retry
            if (handler) await handler.send(msg.chatId, `re-auth failed: ${status.error || 'unknown'}. paste the code again or send /cancel to skip.`);
            return;
          }
          pendingReauths.delete(msg.chatId);
          broadcast({ event: 'provider.auth_complete', data: { provider: 'claude', status } });
          if (handler) await handler.send(msg.chatId, 'authenticated, retrying your message...');
          await processChannelMessage({
            ...msg,
            body: pendingReauth.messageMetadata?.body || msg.body,
            channel: pendingReauth.channel,
            chatId: pendingReauth.chatId,
          });
        } catch (err) {
          console.error('[gateway] re-auth completion failed:', err);
          if (handler) await handler.send(msg.chatId, `re-auth failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        return;
      }
      // "/cancel" clears the pending re-auth
      if (code.toLowerCase() === '/cancel') {
        pendingReauths.delete(msg.chatId);
        const handler = getChannelHandler(msg.channel);
        if (handler) await handler.send(msg.chatId, 'Re-auth cancelled.');
        return;
      }
      // otherwise fall through to normal message processing
    }
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

    // send status message to channel + start typing indicator (stored in channelRunContexts)
    setupChannelStatus(session.key, msg.channel, msg.chatId);

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

    const replyContext = pulseReplyContext || buildPulseReplyContext(msg);

    const channelPrompt = [
      `<incoming_message channel="${msg.channel}" sender="${safeSender}" chat="${msg.chatId}"${mediaAttr}>`,
      safeBody || (msg.mediaPath ? `[Attached: ${msg.mediaType || 'file'} at ${msg.mediaPath}]` : ''),
      `</incoming_message>`,
      '',
      ...(replyContext ? [
        '<pulse_reply_context>',
        replyContext.replace(/</g, '&lt;').replace(/>/g, '&gt;'),
        '</pulse_reply_context>',
        '',
      ] : []),
    ].join('\n');

    // handleAgentRun may never return for persistent sessions (Claude async generator).
    // Per-turn result handling is done inside the stream loop via channelRunContexts.
    // For non-persistent providers (Codex), this returns normally and cleanup below runs as safety net.
    const result = await handleAgentRun({
      prompt: channelPrompt,
      sessionKey: session.key,
      source: `${msg.channel}/${msg.chatId}`,
      channel: msg.channel,
      extraContext: replyContext,
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

    // safety net cleanup for non-persistent providers (stream loop already handles this for persistent)
    const ctx = channelRunContexts.get(session.key);
    if (ctx) {
      clearTypingInterval(ctx);
      channelRunContexts.delete(session.key);
    }
    toolLogs.delete(session.key);
    statusMessages.delete(session.key);

    // process any queued messages (only relevant for non-persistent providers)
    const queued = pendingMessages.get(session.key);
    if (queued && queued.length > 0) {
      const bodies = queued.map(m => m.body);
      pendingMessages.delete(session.key);
      const lastMsg = queued[queued.length - 1];
      await processChannelMessage(lastMsg, bodies);
    }
  }

  // channel manager handles incoming messages from whatsapp/telegram
  const channelManager = new ChannelManager({
    config,
    onMessage: async (msg: InboundMessage) => {
      broadcast({ event: 'channel.message', data: msg });
      const pulseReplyContext = buildPulseReplyContext(msg);

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
      broadcastSessionUpdate(session.key);

      // try injection into active persistent session (even if idle between turns)
      const handle = runHandles.get(session.key);
      console.log(`[onMessage] key=${session.key} activeRun=${session.activeRun} handleExists=${!!handle} handleActive=${handle?.active} runQueueHas=${runQueues.has(session.key)}`);
      if (handle?.active) {
        const safeSender = (msg.senderName || msg.senderId).replace(/[<>"'&\n\r]/g, '_').slice(0, 50);
        const safeBody = msg.body.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const mediaAttr = msg.mediaType ? ` media_type="${msg.mediaType}" media_path="${msg.mediaPath || ''}"` : '';
        const channelPrompt = [
          `<incoming_message channel="${msg.channel}" sender="${safeSender}" chat="${msg.chatId}"${mediaAttr}>`,
          safeBody || (msg.mediaPath ? `[Attached: ${msg.mediaType || 'file'} at ${msg.mediaPath}]` : ''),
          `</incoming_message>`,
          ...(pulseReplyContext ? [
            '',
            '<pulse_reply_context>',
            pulseReplyContext.replace(/</g, '&lt;').replace(/>/g, '&gt;'),
            '</pulse_reply_context>',
          ] : []),
        ].join('\n');
        console.log(`[onMessage] INJECTING into ${session.key}`);
        handle.inject(channelPrompt);
        fileSessionManager.append(session.sessionId, {
          type: 'user',
          timestamp: new Date().toISOString(),
          content: { type: 'user', message: { role: 'user', content: [{ type: 'text', text: channelPrompt }] } },
          metadata: { channel: msg.channel, chatId: msg.chatId, body: msg.body, senderName: msg.senderName },
        });
        broadcast({ event: 'agent.user_message', data: {
          source: `${msg.channel}/${msg.chatId}`, sessionKey: session.key,
          prompt: msg.body, injected: true, timestamp: Date.now(),
        }});
        // re-activate if idle between turns
        if (!session.activeRun) {
          sessionRegistry.setActiveRun(session.key, true);
          broadcast({ event: 'status.update', data: { activeRun: true, source: `${msg.channel}/${msg.chatId}`, sessionKey: session.key } });
        }
        // ensure channel context exists for status message creation in stream loop
        if (!channelRunContexts.has(session.key)) {
          channelRunContexts.set(session.key, { channel: msg.channel, chatId: msg.chatId });
        }
        const h = getChannelHandler(msg.channel);
        if (h?.typing) h.typing(msg.chatId).catch(() => {});
        toolLogs.set(session.key, { completed: [], current: null, lastEditAt: 0 });
        return;
      }

      // agent running but no injectable handle — queue
      console.log(`[onMessage] handle not active, checking activeRun=${session.activeRun}`);
      if (session.activeRun) {
        const queue = pendingMessages.get(session.key) || [];
        queue.push(msg);
        pendingMessages.set(session.key, queue);

        const handler = getChannelHandler(msg.channel);
        if (handler) {
          try { await handler.send(msg.chatId, 'got it, I\'ll get to this after I\'m done'); } catch {}
        }
        return;
      }

      console.log(`[onMessage] falling through to processChannelMessage for ${session.key}`);
      await processChannelMessage(msg, undefined, pulseReplyContext);
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

  // backfill FTS search index for memory_search tool (runs once, skips if already done)
  try {
    const { backfillFtsIndex } = await import('../db.js');
    backfillFtsIndex();
  } catch (err) {
    console.error('[gateway] FTS backfill failed:', err);
  }

  // calendar scheduler
  let scheduler: SchedulerRunner | null = null;
  if (config.calendar?.enabled !== false && config.cron?.enabled !== false) {
    migrateCronToCalendar();
    scheduler = startScheduler({
      config,
      getContext: () => ({
        connectedChannels: getAllChannelStatuses()
          .filter(s => s.connected && ownerChatIds.has(s.channel))
          .map(s => ({ channel: s.channel, chatId: ownerChatIds.get(s.channel)! })),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
      onItemStart: (item) => {
        if (item.id === AUTONOMOUS_SCHEDULE_ID) {
          macNotify('Dora', 'Checking in... 👀');
          broadcast({ event: 'pulse:started', data: { timestamp: Date.now() } });
        } else {
          macNotify('Dora', `Working on "${item.summary}"`);
        }
      },
      onItemRun: (item, result) => {
        if (item.id === AUTONOMOUS_SCHEDULE_ID) {
          if (result.messaged) {
            macNotify('Dora', 'Sent you a message 👀');
          } else {
            macNotify('Dora', result.status === 'ran' ? 'All caught up ✓' : 'Something went wrong, check logs');
          }
        } else {
          macNotify('Dora', result.status === 'ran' ? `Done with "${item.summary}" ✓` : `"${item.summary}" failed`);
        }
        broadcast({ event: 'calendar.result', data: { item: item.id, summary: item.summary, ...result, timestamp: Date.now() } });
        if (item.id === AUTONOMOUS_SCHEDULE_ID) {
          broadcast({ event: 'pulse:completed', data: { timestamp: Date.now(), ...result } });
        }
      },
      runItem: async (item, _cfg, ctx) => {
        const connectedOwners = ctx.connectedChannels || [];
        const preferredOwner = connectedOwners.find(c => c.channel === 'telegram')
          || connectedOwners.find(c => c.channel === 'whatsapp')
          || connectedOwners[0];

        const useOwnerChannel = item.session !== 'isolated' && !!preferredOwner;
        const runChannel = useOwnerChannel ? preferredOwner!.channel : undefined;
        const runChatId = useOwnerChannel ? preferredOwner!.chatId : undefined;
        const runSessionChatId = `${item.id}-${Date.now().toString(36)}`;

        const session = sessionRegistry.getOrCreate({
          channel: 'calendar',
          chatId: runSessionChatId,
          chatType: 'dm',
        });
        fileSessionManager.setMetadata(session.sessionId, {
          channel: 'calendar',
          chatId: runSessionChatId,
          chatType: 'dm',
          senderName: item.summary,
        });
        sessionRegistry.incrementMessages(session.key);
        broadcastSessionUpdate(session.key);

        const result = await handleAgentRun({
          prompt: item.message,
          sessionKey: session.key,
          source: `calendar/${item.id}`,
          channel: runChannel,
          messageMetadata: runChannel && runChatId ? {
            channel: runChannel,
            chatId: runChatId,
            chatType: 'dm',
            senderName: item.summary,
            body: item.message,
          } : undefined,
          extraContext: ctx.timezone ? `User timezone: ${ctx.timezone}` : undefined,
        });
        return result || { sessionId: '', result: '', messages: [], usage: { inputTokens: 0, outputTokens: 0, totalCostUsd: 0 }, durationMs: 0, usedMessageTool: false };
      },
    });
    setScheduler(scheduler);

    // auto-create autonomous schedule if mode is autonomous
    if (config.autonomy === 'autonomous') {
      const existing = scheduler.listItems().find(i => i.id === AUTONOMOUS_SCHEDULE_ID);
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const desired = buildAutonomousCalendarItem(tz);
      if (!existing) {
        scheduler.addItem({ ...desired, id: AUTONOMOUS_SCHEDULE_ID });
        console.log('[gateway] created autonomy pulse schedule on startup');
      } else {
        const needsRefresh =
          existing.summary !== desired.summary ||
          existing.description !== desired.description ||
          existing.message !== desired.message ||
          existing.timezone !== desired.timezone ||
          existing.enabled === false;
        if (needsRefresh) {
          scheduler.updateItem(AUTONOMOUS_SCHEDULE_ID, {
            summary: desired.summary,
            description: desired.description,
            message: desired.message,
            timezone: desired.timezone,
            enabled: true,
          });
          console.log('[gateway] refreshed autonomy pulse schedule on startup');
        }
      }
    }
  }

  const context: GatewayContext = {
    config,
    sessionRegistry,
    channelManager,
    scheduler,
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

  async function waitForApproval(requestId: string, toolName: string, input: Record<string, unknown>, timeoutMs?: number, sessionKey?: string): Promise<{ approved: boolean; reason?: string; modifiedInput?: Record<string, unknown> }> {
    // persist to snapshot
    if (sessionKey) {
      const snap = sessionSnapshots.get(sessionKey);
      if (snap) { snap.pendingApproval = { requestId, toolName, input, timestamp: Date.now() }; snap.updatedAt = Date.now(); }
    }
    return new Promise((resolve) => {
      const timer = timeoutMs ? setTimeout(() => {
        pendingApprovals.delete(requestId);
        if (sessionKey) { const snap = sessionSnapshots.get(sessionKey); if (snap) snap.pendingApproval = null; }
        resolve({ approved: false, reason: 'approval timeout' });
      }, timeoutMs) : null;

      pendingApprovals.set(requestId, { resolve, toolName, input, timeout: timer });
    }).then((decision) => {
      if (sessionKey) { const snap = sessionSnapshots.get(sessionKey); if (snap) snap.pendingApproval = null; }
      return decision;
    }) as Promise<{ approved: boolean; reason?: string; modifiedInput?: Record<string, unknown> }>;
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

  function makeCanUseTool(runChannel?: string, runChatId?: string, runSessionKey?: string) {
    return async (toolName: string, input: Record<string, unknown>) => {
      return canUseToolImpl(toolName, input, runChannel, runChatId, runSessionKey);
    };
  }

  const canUseTool = async (toolName: string, input: Record<string, unknown>) => {
    return canUseToolImpl(toolName, input, undefined, undefined, undefined);
  };

  const canUseToolImpl = async (toolName: string, input: Record<string, unknown>, runChannel?: string, runChatId?: string, runSessionKey?: string) => {
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
        data: { requestId, questions, sessionKey: runSessionKey, timestamp: Date.now() },
      });
      // persist to snapshot
      if (runSessionKey) {
        const snap = sessionSnapshots.get(runSessionKey);
        if (snap) { snap.pendingQuestion = { requestId, questions, timestamp: Date.now() }; snap.updatedAt = Date.now(); }
      }

      const answers = await new Promise<Record<string, string>>((resolveQ, rejectQ) => {
        pendingQuestions.set(requestId, { resolve: resolveQ, reject: rejectQ });
        setTimeout(() => {
          if (pendingQuestions.has(requestId)) {
            pendingQuestions.delete(requestId);
            if (runSessionKey) { const snap = sessionSnapshots.get(runSessionKey); if (snap) snap.pendingQuestion = null; }
            broadcast({
              event: 'agent.question_dismissed',
              data: { requestId, sessionKey: runSessionKey, reason: 'timeout' },
            });
            rejectQ(new Error('Question timeout - no answer received'));
          }
        }, 300000);
      });
      if (runSessionKey) { const snap = sessionSnapshots.get(runSessionKey); if (snap) snap.pendingQuestion = null; }

      return {
        behavior: 'allow' as const,
        updatedInput: { questions, answers },
      };
    }

    const cleanName = cleanToolName(toolName);
    if (cleanName === 'message' && runSessionKey) {
      const runSource = activeRunSources.get(runSessionKey);
      const targetChannel = typeof input.channel === 'string' ? input.channel : runChannel;
      if (runSource === `calendar/${AUTONOMOUS_SCHEDULE_ID}` && targetChannel === 'telegram' && typeof input.message === 'string') {
        input.message = appendPulseSessionMarker(input.message, runSource, runSessionKey, targetChannel);
      }
    }

    // check tool allow/deny policy (channel-specific + global)
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
      const decision = await waitForApproval(requestId, cleanName, input, undefined, runSessionKey);
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

      const decision = await waitForApproval(requestId, cleanName, input, undefined, runSessionKey);

      if (decision.approved) {
        return { behavior: 'allow' as const, updatedInput: decision.modifiedInput || input };
      }
      return { behavior: 'deny' as const, message: decision.reason || 'user denied' };
    }

    return { behavior: 'allow' as const, updatedInput: input };
  };

  // track which channel each active run belongs to (for tool policy lookups)
  const activeRunChannels = new Map<string, string>();
  const activeRunSources = new Map<string, string>();

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

    // pre-run auth check: if dorabot_oauth token is expired, don't waste a run
    const authMethod = getActiveAuthMethod();
    if (authMethod === 'dorabot_oauth' && isOAuthTokenExpired()) {
      console.log(`[gateway] token expired pre-run, triggering re-auth for ${source}`);
      await startReauthFlow({ prompt, sessionKey, source, channel, chatId: messageMetadata?.chatId, messageMetadata }).catch(() => {});
      return null;
    }
    if (authMethod === 'none') {
      console.log(`[gateway] no auth configured, skipping run for ${source}`);
      broadcast({ event: 'agent.error', data: { source, sessionKey, error: 'Not authenticated', timestamp: Date.now() } });
      return null;
    }

    const prev = runQueues.get(sessionKey) || Promise.resolve();
    const hasPrev = runQueues.has(sessionKey);
    console.log(`[handleAgentRun] sessionKey=${sessionKey} hasPrevInQueue=${hasPrev}`);
    let result: AgentResult | null = null;

    const run = prev.then(async () => {
      console.log(`[handleAgentRun] prev resolved, starting run for ${sessionKey}`);
      sessionRegistry.setActiveRun(sessionKey, true);
      if (channel) activeRunChannels.set(sessionKey, channel);
      activeRunSources.set(sessionKey, source);
      // init snapshot
      sessionSnapshots.set(sessionKey, {
        sessionKey, status: 'thinking', text: '',
        currentTool: null, completedTools: [],
        pendingApproval: null, pendingQuestion: null,
        updatedAt: Date.now(),
      });
      broadcastStatus(sessionKey, 'thinking');
      broadcast({ event: 'status.update', data: { activeRun: true, source, sessionKey } });
      broadcastSessionUpdate(sessionKey);
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
          canUseTool: makeCanUseTool(channel, messageMetadata?.chatId, sessionKey),
          abortController,
          messageMetadata,
          onRunReady: (handle) => { runHandles.set(sessionKey, handle); },
        });

        let agentText = '';
        let agentSessionId = '';
        let agentUsage = { inputTokens: 0, outputTokens: 0, totalCostUsd: 0 };
        let usedMessageTool = false;
        let hadStreamEvents = false;

        // track Task tool_use IDs so we can recognize their tool_results
        const taskToolUseIds = new Set<string>();
        const toolUseMeta = new Map<string, { name: string; input: Record<string, unknown> }>();

        const maybeRegisterPulseRefFromToolResult = (toolUseId: string, toolResultText: string) => {
          const meta = toolUseMeta.get(toolUseId);
          if (!meta || meta.name !== 'message') return;
          const sentId = toolResultText.match(/Message sent\. ID:\s*([^\s]+)/)?.[1];
          const targetChannel = typeof meta.input.channel === 'string' ? meta.input.channel : channel;
          const targetChatId = typeof meta.input.target === 'string' ? meta.input.target : undefined;
          const outboundText = typeof meta.input.message === 'string' ? meta.input.message : '';
          if (!sentId || !targetChannel || !targetChatId) return;
          registerPulseReplyRef(source, sessionKey, targetChannel, targetChatId, sentId, outboundText);
        };

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
            const evtType = event.type as string;

            // track Task tool_use IDs
            if (evtType === 'content_block_start') {
              const cb = event.content_block as Record<string, unknown>;
              if (cb?.type === 'tool_use' && cleanToolName(cb.name as string) === 'Task') {
                taskToolUseIds.add(cb.id as string);
              }
            }

            // SDK sets parent_tool_use_id on user messages (tool_results) but not
            // on stream_events. subagent stream_events are not yielded by the SDK —
            // only their tool_results come through as user messages.
            const parentId = m.parent_tool_use_id || null;

            // new turn starting — re-activate if idle between turns
            if (evtType === 'message_start' && !sessionRegistry.get(sessionKey)?.activeRun) {
              sessionRegistry.setActiveRun(sessionKey, true);
              broadcast({ event: 'status.update', data: { activeRun: true, source, sessionKey } });
              broadcastSessionUpdate(sessionKey);
            }

            // debug: log stream events
            if (evtType === 'content_block_start' || evtType === 'message_start') {
              const cb = (event as any).content_block;
              console.log(`[stream] ${evtType} parent=${parentId} block=${cb?.type || '-'} name=${cb?.name || '-'} id=${cb?.id || '-'}`);
            }

            broadcast({
              event: 'agent.stream',
              data: { source, sessionKey, event, parentToolUseId: parentId, timestamp: Date.now() },
            });

            // update snapshot on stream events
            const snap = sessionSnapshots.get(sessionKey);
            if (snap && !parentId) {
              if (evtType === 'content_block_start') {
                const cb2 = event.content_block as Record<string, unknown>;
                if (cb2?.type === 'text') {
                  snap.status = 'responding';
                  snap.updatedAt = Date.now();
                  broadcastStatus(sessionKey, 'responding');
                }
              } else if (evtType === 'content_block_delta') {
                const delta = event.delta as Record<string, unknown>;
                if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
                  snap.text += delta.text as string;
                  snap.updatedAt = Date.now();
                }
              }
            }

            if (event.type === 'content_block_start') {
              const cb = event.content_block as Record<string, unknown>;
              if (cb?.type === 'tool_use') {
                const toolName = cleanToolName(cb.name as string);
                // debug: log tool_use starts with their IDs
                console.log(`[tool_use] name=${toolName} id=${cb.id} parent=${m.parent_tool_use_id || 'none'}`);
                if (toolName === 'message') usedMessageTool = true;
                broadcast({
                  event: 'agent.tool_use',
                  data: { source, sessionKey, tool: toolName, timestamp: Date.now() },
                });
                // snapshot: tool_use start
                if (snap) {
                  if (snap.currentTool) snap.completedTools.push({ name: snap.currentTool.name, detail: snap.currentTool.detail });
                  snap.currentTool = { name: toolName, inputJson: '', detail: '' };
                  snap.status = 'tool_use';
                  snap.updatedAt = Date.now();
                  broadcastStatus(sessionKey, 'tool_use', toolName);
                }

                // new turn on channel — create fresh status message if none exists
                const ctx = channelRunContexts.get(sessionKey);
                if (ctx && !ctx.statusMsgId) {
                  clearTypingInterval(ctx);
                  const h = getChannelHandler(ctx.channel);
                  if (h) {
                    try {
                      if (h.typing) h.typing(ctx.chatId).catch(() => {});
                      const sent = await h.send(ctx.chatId, 'thinking...');
                      ctx.statusMsgId = sent.id;
                      statusMessages.set(sessionKey, { channel: ctx.channel, chatId: ctx.chatId, messageId: sent.id });
                      if (h.typing) {
                        clearTypingInterval(ctx);
                        ctx.typingInterval = setInterval(() => { h.typing!(ctx.chatId).catch(() => {}); }, 4500);
                      }
                    } catch {}
                  }
                }

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
                      if (h) { h.edit(sm.messageId, text, sm.chatId).catch(() => {}); }
                    }
                  }
                }
              }
            }

            // accumulate tool input json
            if (event.type === 'content_block_delta') {
              const delta = event.delta as Record<string, unknown>;
              if (delta?.type === 'input_json_delta') {
                const partial = String(delta.partial_json || '');
                const tl = toolLogs.get(sessionKey);
                if (tl?.current) {
                  tl.current.inputJson += partial;
                }
                if (snap?.currentTool) {
                  snap.currentTool.inputJson += partial;
                }
              }
            }

            // tool input complete — extract detail and force update (no throttle)
            if (event.type === 'content_block_stop') {
              const tl = toolLogs.get(sessionKey);
              if (tl?.current && tl.current.inputJson) {
                try {
                  const input = JSON.parse(tl.current.inputJson);
                  const detail = extractToolDetail(tl.current.name, input);
                  tl.current.detail = detail;
                  if (snap?.currentTool) {
                    snap.currentTool.detail = detail;
                    snap.updatedAt = Date.now();
                    broadcastStatus(sessionKey, 'tool_use', snap.currentTool.name, detail);
                  }
                } catch {}
                // force edit — detail is worth showing immediately
                const sm = statusMessages.get(sessionKey);
                if (sm) {
                  tl.lastEditAt = Date.now();
                  const text = buildToolStatusText(tl.completed, tl.current);
                  const h = getChannelHandler(sm.channel);
                  if (h) { h.edit(sm.messageId, text, sm.chatId).catch(() => {}); }
                }
              }
            }
          }

          if (m.type === 'assistant') {
            const isSubagentMsg = !!(m.parent_tool_use_id);
            // broadcast full assistant messages for:
            // 1. non-streaming providers (Codex) — no stream_events exist
            // 2. subagent messages — SDK yields these as complete messages, not stream_events
            if (!hadStreamEvents || isSubagentMsg) {
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
                if (b.type === 'text' && !isSubagentMsg) agentText = b.text as string;
                if (b.type === 'tool_use' && typeof b.id === 'string') {
                  let parsedInput: Record<string, unknown> = {};
                  if (typeof b.input === 'string') {
                    try {
                      const parsed = JSON.parse(b.input);
                      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                        parsedInput = parsed as Record<string, unknown>;
                      }
                    } catch {}
                  } else if (b.input && typeof b.input === 'object' && !Array.isArray(b.input)) {
                    parsedInput = b.input as Record<string, unknown>;
                  }
                  toolUseMeta.set(b.id, { name: cleanToolName(String(b.name || '')), input: parsedInput });
                }
                // broadcast tool_use for non-streaming providers and subagent messages
                if ((!hadStreamEvents || isSubagentMsg) && b.type === 'tool_use') {
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
                      if (h) { h.edit(sm.messageId, text, sm.chatId).catch(() => {}); }
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
                  // SDK sets parent_tool_use_id on subagent tool_results correctly.
                  // Task tool_results themselves have null parent (they're top-level).
                  const sdkParentId = (m as any).parent_tool_use_id || null;
                  const isTaskResult = taskToolUseIds.has(block.tool_use_id);
                  const parentId = isTaskResult ? null : sdkParentId;
                  if (isTaskResult) taskToolUseIds.delete(block.tool_use_id);

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
                  maybeRegisterPulseRefFromToolResult(String(block.tool_use_id || ''), resultText);
                  broadcast({
                    event: 'agent.tool_result',
                    data: {
                      source,
                      sessionKey,
                      tool_use_id: block.tool_use_id,
                      content: resultText.slice(0, 2000),
                      imageData,
                      is_error: block.is_error || false,
                      parentToolUseId: parentId,
                      timestamp: Date.now(),
                    },
                  });
                  // snapshot: tool_result → thinking
                  const snap2 = sessionSnapshots.get(sessionKey);
                  if (snap2 && !parentId) {
                    if (snap2.currentTool) snap2.completedTools.push({ name: snap2.currentTool.name, detail: snap2.currentTool.detail });
                    snap2.currentTool = null;
                    snap2.status = 'thinking';
                    snap2.updatedAt = Date.now();
                    broadcastStatus(sessionKey, 'thinking');
                  }
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
            maybeRegisterPulseRefFromToolResult(toolUseId, resultContent);
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

            // per-turn: broadcast agent.result so desktop sets agentStatus to idle
            broadcast({
              event: 'agent.result',
              data: {
                source,
                sessionKey,
                sessionId: agentSessionId || '',
                result: agentText,
                usage: agentUsage,
                timestamp: Date.now(),
              },
            });

            // per-turn: broadcast goals.update if agent used goals tools
            const tl = toolLogs.get(sessionKey);
            if (tl) {
              const allTools = [...tl.completed.map(t => t.name), tl.current?.name].filter(Boolean);
              if (allTools.some(t => t?.startsWith('goals_') || t?.startsWith('mcp__dorabot-tools__goals_'))) {
                broadcast({ event: 'goals.update', data: {} });
                macNotify('Dora', 'Goals updated');
              }
              if (allTools.some(t => t?.startsWith('research_') || t?.startsWith('mcp__dorabot-tools__research_'))) {
                broadcast({ event: 'research.update', data: {} });
                macNotify('Dora', 'Research updated');
              }
            }

            // per-turn channel cleanup — delete status msg, send result, reset for next turn
            const ctx = channelRunContexts.get(sessionKey);
            if (ctx) {
              clearTypingInterval(ctx);
              const h = getChannelHandler(ctx.channel);
              if (h && ctx.statusMsgId) {
                try { await h.delete(ctx.statusMsgId, ctx.chatId); } catch {}
                ctx.statusMsgId = undefined;
              }
              statusMessages.delete(sessionKey);
              if (h && !usedMessageTool && agentText) {
                try {
                  const outboundText = appendPulseSessionMarker(agentText, source, sessionKey, ctx.channel);
                  const sent = await h.send(ctx.chatId, outboundText);
                  registerPulseReplyRef(source, sessionKey, ctx.channel, ctx.chatId, sent.id, outboundText);
                } catch {}
              }
            }

            // per-turn: mark idle so sidebar spinner stops
            sessionRegistry.setActiveRun(sessionKey, false);
            broadcastStatus(sessionKey, 'idle');
            broadcast({ event: 'status.update', data: { activeRun: false, source, sessionKey } });
            broadcastSessionUpdate(sessionKey);

            // clear snapshot on turn end
            sessionSnapshots.delete(sessionKey);

            // reset for next turn (persistent sessions get multiple result events)
            usedMessageTool = false;
            agentText = '';
            toolLogs.set(sessionKey, { completed: [], current: null, lastEditAt: 0 });
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

        // agent.result and goals.update are broadcast per-turn inside executeStream's result handler.
        // This point is only reached when the run actually ends (abort, error, or non-persistent provider).
        console.log(`[gateway] agent run ended: source=${source} result="${result.result.slice(0, 100)}..." cost=$${result.usage.totalCostUsd?.toFixed(4) || '?'}`);
      } catch (err) {
        console.error(`[gateway] agent error: source=${source}`, err);
        if (isAuthError(err)) {
          console.log(`[gateway] auth error for ${source}, starting re-auth flow`);
          await startReauthFlow({ prompt, sessionKey, source, channel, chatId: messageMetadata?.chatId, messageMetadata }).catch(() => {});
        }
        broadcast({
          event: 'agent.error',
          data: { source, sessionKey, error: err instanceof Error ? err.message : String(err), timestamp: Date.now() },
        });
      } finally {
        activeAbortControllers.delete(sessionKey);
        activeRunChannels.delete(sessionKey);
        activeRunSources.delete(sessionKey);
        runHandles.delete(sessionKey);
        // clean up any remaining channel context (typing indicator, status message)
        const ctx = channelRunContexts.get(sessionKey);
        if (ctx) {
          clearTypingInterval(ctx);
          if (ctx.statusMsgId) {
            const h = getChannelHandler(ctx.channel);
            if (h) { try { await h.delete(ctx.statusMsgId, ctx.chatId); } catch {} }
          }
          channelRunContexts.delete(sessionKey);
        }
        statusMessages.delete(sessionKey);
        toolLogs.delete(sessionKey);
        sessionSnapshots.delete(sessionKey);
        sessionRegistry.setActiveRun(sessionKey, false);
        broadcastStatus(sessionKey, 'idle');
        broadcast({ event: 'status.update', data: { activeRun: false, source, sessionKey } });
        broadcastSessionUpdate(sessionKey);
      }
    });

    runQueues.set(sessionKey, run.catch(() => {}));
    await run;
    return result;
  }

  // rpc handler
  async function handleRpc(msg: WsMessage, clientWs?: WebSocket): Promise<WsResponse> {
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
              calendar: scheduler ? {
                enabled: true,
                itemCount: scheduler.listItems().length,
              } : null,
            },
          };
        }

        case 'sessions.subscribe': {
          const keys = params?.sessionKeys as string[];
          if (!Array.isArray(keys)) return { id, error: 'sessionKeys required' };
          const lastSeq = typeof params?.lastSeq === 'number' ? params.lastSeq : 0;
          const state = clientWs ? clients.get(clientWs) : undefined;
          if (state) keys.forEach(k => state.subscriptions.add(k));
          // replay persisted events for exact continuity before snapshot/live stream
          if (clientWs) {
            const events = queryEvents(keys, lastSeq);
            for (const row of events) {
              clientWs.send(JSON.stringify({ event: row.event_type, data: JSON.parse(row.data), seq: row.seq }));
            }
          }
          // send snapshots for any active sessions
          for (const sk of keys) {
            const snap = sessionSnapshots.get(sk);
            if (snap && clientWs) {
              clientWs.send(JSON.stringify({ event: 'session.snapshot', data: snap }));
            }
          }
          return { id, result: { subscribed: keys } };
        }

        case 'sessions.unsubscribe': {
          const keys = params?.sessionKeys as string[];
          if (!Array.isArray(keys)) return { id, error: 'sessionKeys required' };
          const state = clientWs ? clients.get(clientWs) : undefined;
          if (state) keys.forEach(k => state.subscriptions.delete(k));
          return { id, result: { unsubscribed: keys } };
        }

        case 'chat.send': {
          const prompt = params?.prompt as string;
          if (!prompt) return { id, error: 'prompt required' };

          const chatId = (params?.chatId as string) || `task-${Date.now()}`;
          const sessionKey = `desktop:dm:${chatId}`;
          let session = sessionRegistry.getOrCreate({
            channel: 'desktop',
            chatId,
          });

          // idle timeout: reset session if too long since last message
          const desktopGap = Date.now() - session.lastMessageAt;
          if (session.messageCount > 0 && desktopGap > IDLE_TIMEOUT_MS) {
            console.log(`[gateway] idle timeout for ${session.key} (${Math.floor(desktopGap / 3600000)}h), starting new session`);
            fileSessionManager.setMetadata(session.sessionId, { sdkSessionId: undefined });
            sessionRegistry.remove(session.key);
            session = sessionRegistry.getOrCreate({ channel: 'desktop', chatId });
          }

          sessionRegistry.incrementMessages(session.key);
          fileSessionManager.setMetadata(session.sessionId, { channel: 'desktop', chatId, chatType: 'dm' });
          broadcastSessionUpdate(sessionKey);

          // try injection into active run first
          const handle = runHandles.get(sessionKey);
          if (handle?.active) {
            handle.inject(prompt);
            // record injected user message in session (CLI doesn't echo user text back)
            fileSessionManager.append(session.sessionId, {
              type: 'user',
              timestamp: new Date().toISOString(),
              content: { type: 'user', message: { role: 'user', content: [{ type: 'text', text: prompt }] } },
            });
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
          const sk = params?.sessionKey as string;
          if (!sk) return { id, error: 'sessionKey required' };
          const ac = activeAbortControllers.get(sk);
          if (!ac) return { id, error: 'no active run for that session' };
          ac.abort();
          console.log(`[gateway] agent aborted: sessionKey=${sk}`);
          return { id, result: { aborted: true, sessionKey: sk } };
        }

        case 'agent.interrupt': {
          const sk = params?.sessionKey as string;
          if (!sk) return { id, error: 'sessionKey required' };
          const h = runHandles.get(sk);
          if (!h?.active) return { id, error: 'no active run for that session' };
          if (!h.interrupt) return { id, error: 'interrupt not supported by current provider' };
          await h.interrupt();
          return { id, result: { interrupted: true, sessionKey: sk } };
        }

        case 'agent.setModel': {
          const sk = params?.sessionKey as string;
          const model = params?.model as string;
          if (!sk) return { id, error: 'sessionKey required' };
          if (!model) return { id, error: 'model required' };
          const h = runHandles.get(sk);
          if (!h?.active) return { id, error: 'no active run for that session' };
          if (!h.setModel) return { id, error: 'setModel not supported by current provider' };
          await h.setModel(model);
          return { id, result: { model, sessionKey: sk } };
        }

        case 'agent.stopTask': {
          const sk = params?.sessionKey as string;
          const taskId = params?.taskId as string;
          if (!sk) return { id, error: 'sessionKey required' };
          if (!taskId) return { id, error: 'taskId required' };
          const h = runHandles.get(sk);
          if (!h?.active) return { id, error: 'no active run for that session' };
          if (!h.stopTask) return { id, error: 'stopTask not supported by current provider' };
          await h.stopTask(taskId);
          return { id, result: { stopped: true, taskId, sessionKey: sk } };
        }

        case 'agent.mcpStatus': {
          const sk = params?.sessionKey as string;
          if (!sk) return { id, error: 'sessionKey required' };
          const h = runHandles.get(sk);
          if (!h?.active) return { id, error: 'no active run for that session' };
          if (!h.mcpServerStatus) return { id, error: 'mcpServerStatus not supported by current provider' };
          const status = await h.mcpServerStatus();
          return { id, result: status };
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
          const activeIds = new Set(
            sessionRegistry.getActiveRunKeys()
              .map(k => sessionRegistry.get(k)?.sessionId)
              .filter(Boolean),
          );
          const result = fileSessions.map(s => ({
            ...s,
            activeRun: activeIds.has(s.id),
          }));
          return { id, result };
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

          const ch = (params?.channel as string) || meta.channel || 'desktop';
          const cid = (params?.chatId as string) || meta.chatId || sessionId;
          const ct = meta.chatType || 'dm';
          const key = sessionRegistry.makeKey({ channel: ch, chatId: cid, chatType: ct });

          const existing = sessionRegistry.get(key);
          if (existing?.activeRun) return { id, error: 'cannot resume while agent is running' };

          sessionRegistry.remove(key);
          sessionRegistry.getOrCreate({ channel: ch, chatId: cid, chatType: ct, sessionId });
          if (meta.sdkSessionId) {
            sessionRegistry.setSdkSessionId(key, meta.sdkSessionId);
          }
          // backfill chatId into metadata so future resumes don't fallback
          if (!meta.chatId && cid !== 'default') {
            fileSessionManager.setMetadata(sessionId, { channel: ch, chatId: cid, chatType: ct });
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

        case 'calendar.list':
        case 'cron.list': {
          const items = scheduler?.listItems() || loadCalendarItems();
          return { id, result: items };
        }

        case 'calendar.add':
        case 'cron.add': {
          if (!scheduler) return { id, error: 'scheduler not enabled' };
          const data = params as any;
          // backward compat: map old CronJob fields to CalendarItem
          if (data.name && !data.summary) data.summary = data.name;
          if (!data.dtstart) data.dtstart = new Date().toISOString();
          if (!data.type) data.type = data.deleteAfterRun ? 'reminder' : 'event';
          if (!data.message) return { id, error: 'message required' };
          const item = scheduler.addItem(data);
          return { id, result: item };
        }

        case 'calendar.remove':
        case 'cron.remove': {
          if (!scheduler) return { id, error: 'scheduler not enabled' };
          const itemId = params?.id as string;
          if (!itemId) return { id, error: 'id required' };
          const removed = scheduler.removeItem(itemId);
          return { id, result: { removed } };
        }

        case 'calendar.toggle':
        case 'cron.toggle': {
          if (!scheduler) return { id, error: 'scheduler not enabled' };
          const itemId = params?.id as string;
          if (!itemId) return { id, error: 'id required' };
          const items = scheduler.listItems();
          const item = items.find(i => i.id === itemId);
          if (!item) return { id, error: 'item not found' };
          const updated = scheduler.updateItem(itemId, { enabled: !item.enabled });
          return { id, result: { id: itemId, enabled: updated?.enabled } };
        }

        case 'calendar.run':
        case 'cron.run': {
          if (!scheduler) return { id, error: 'scheduler not enabled' };
          const itemId = params?.id as string;
          if (!itemId) return { id, error: 'id required' };
          // fire and forget — agent runs can take minutes, don't block the RPC
          scheduler.runItemNow(itemId).catch(err => {
            console.error(`[gateway] calendar run failed for ${itemId}:`, err);
          });
          return { id, result: { status: 'started' } };
        }

        case 'calendar.update': {
          if (!scheduler) return { id, error: 'scheduler not enabled' };
          const itemId = params?.id as string;
          if (!itemId) return { id, error: 'id required' };
          const { id: _removeId, ...updates } = params as any;
          const updated = scheduler.updateItem(itemId, updates);
          if (!updated) return { id, error: 'item not found' };
          return { id, result: updated };
        }

        case 'calendar.export': {
          if (!scheduler) return { id, error: 'scheduler not enabled' };
          const icsString = scheduler.exportIcs();
          return { id, result: { ics: icsString } };
        }

        case 'pulse.status': {
          const pulseItem = scheduler?.listItems().find(i => i.id === AUTONOMOUS_SCHEDULE_ID);
          return {
            id,
            result: {
              enabled: !!pulseItem?.enabled,
              interval: pulseItem ? rruleToPulseInterval(pulseItem.rrule || '') : DEFAULT_PULSE_INTERVAL,
              lastRunAt: pulseItem?.lastRunAt || null,
              nextRunAt: pulseItem?.nextRunAt || null,
            },
          };
        }

        case 'pulse.setInterval': {
          if (!scheduler) return { id, error: 'scheduler not enabled' };
          const interval = params?.interval as string;
          if (!PULSE_INTERVALS.includes(interval)) return { id, error: `interval must be one of: ${PULSE_INTERVALS.join(', ')}` };
          const item = scheduler.listItems().find(i => i.id === AUTONOMOUS_SCHEDULE_ID);
          if (!item) return { id, error: 'pulse not enabled' };
          const updated = scheduler.updateItem(AUTONOMOUS_SCHEDULE_ID, { rrule: pulseIntervalToRrule(interval) });
          return { id, result: updated };
        }

        case 'goals.list': {
          const goals = loadGoals();
          return { id, result: goals.tasks };
        }

        case 'goals.add': {
          const goals = loadGoals();
          const title = params?.title as string;
          if (!title) return { id, error: 'title required' };
          const now = new Date().toISOString();
          const ids = goals.tasks.map(t => parseInt(t.id, 10)).filter(n => !isNaN(n));
          const newId = String((ids.length > 0 ? Math.max(...ids) : 0) + 1);
          const source = (params?.source as string) || 'user';
          const task: GoalTask = {
            id: newId,
            title,
            description: params?.description as string | undefined,
            status: (params?.status as GoalTask['status']) || (source === 'user' ? 'approved' : 'proposed'),
            priority: (params?.priority as GoalTask['priority']) || 'medium',
            source: source as 'agent' | 'user',
            createdAt: now,
            updatedAt: now,
            tags: params?.tags as string[] | undefined,
          };
          goals.tasks.push(task);
          saveGoals(goals);
          broadcast({ event: 'goals.update', data: {} });
          macNotify('Dora', `Goal added: ${task.title}`);
          return { id, result: task };
        }

        case 'goals.update': {
          const taskId = params?.id as string;
          if (!taskId) return { id, error: 'id required' };
          const goals = loadGoals();
          const task = goals.tasks.find(t => t.id === taskId);
          if (!task) return { id, error: 'task not found' };
          const now = new Date().toISOString();
          if (params?.status !== undefined) task.status = params.status as GoalTask['status'];
          if (params?.title !== undefined) task.title = params.title as string;
          if (params?.description !== undefined) task.description = params.description as string;
          if (params?.priority !== undefined) task.priority = params.priority as GoalTask['priority'];
          if (params?.result !== undefined) task.result = params.result as string;
          if (params?.tags !== undefined) task.tags = params.tags as string[];
          task.updatedAt = now;
          if (task.status === 'done') task.completedAt = now;
          saveGoals(goals);
          broadcast({ event: 'goals.update', data: {} });
          macNotify('Dora', `Goal updated: ${task.title}`);
          return { id, result: task };
        }

        case 'goals.delete': {
          const taskId = params?.id as string;
          if (!taskId) return { id, error: 'id required' };
          const goals = loadGoals();
          const before = goals.tasks.length;
          goals.tasks = goals.tasks.filter(t => t.id !== taskId);
          if (goals.tasks.length === before) return { id, error: 'task not found' };
          saveGoals(goals);
          broadcast({ event: 'goals.update', data: {} });
          macNotify('Dora', `Goal deleted: #${taskId}`);
          return { id, result: { deleted: true } };
        }

        case 'goals.move': {
          const taskId = params?.id as string;
          const status = params?.status as string;
          if (!taskId || !status) return { id, error: 'id and status required' };
          const goals = loadGoals();
          const task = goals.tasks.find(t => t.id === taskId);
          if (!task) return { id, error: 'task not found' };
          task.status = status as GoalTask['status'];
          task.updatedAt = new Date().toISOString();
          if (status === 'done') task.completedAt = task.updatedAt;
          saveGoals(goals);
          broadcast({ event: 'goals.update', data: {} });
          macNotify('Dora', `Goal moved: ${task.title} → ${status}`);
          return { id, result: task };
        }

        // ── Research ──

        case 'research.list': {
          const research = loadResearch();
          return { id, result: research.items };
        }

        case 'research.read': {
          const itemId = params?.id as string;
          if (!itemId) return { id, error: 'id required' };
          const research = loadResearch();
          const item = research.items.find(i => i.id === itemId);
          if (!item) return { id, error: 'item not found' };
          const content = readResearchContent(item.filePath);
          return { id, result: { ...item, content } };
        }

        case 'research.update': {
          const itemId = params?.id as string;
          if (!itemId) return { id, error: 'id required' };
          const research = loadResearch();
          const item = research.items.find(i => i.id === itemId);
          if (!item) return { id, error: 'item not found' };
          if (params?.status !== undefined) item.status = params.status as ResearchItem['status'];
          if (params?.title !== undefined) item.title = params.title as string;
          if (params?.topic !== undefined) item.topic = params.topic as string;
          if (params?.sources !== undefined) item.sources = params.sources as string[];
          if (params?.tags !== undefined) item.tags = params.tags as string[];
          item.updatedAt = new Date().toISOString();
          saveResearch(research);
          broadcast({ event: 'research.update', data: {} });
          macNotify('Dora', `Research updated: ${item.title}`);
          return { id, result: item };
        }

        case 'research.delete': {
          const itemId = params?.id as string;
          if (!itemId) return { id, error: 'id required' };
          const research = loadResearch();
          const deleted = research.items.find(i => i.id === itemId);
          if (!deleted) return { id, error: 'item not found' };
          research.items = research.items.filter(i => i.id !== itemId);
          saveResearch(research);
          // clean up file
          try { if (existsSync(deleted.filePath)) unlinkSync(deleted.filePath); } catch {}
          broadcast({ event: 'research.update', data: {} });
          macNotify('Dora', `Research deleted: ${deleted.title}`);
          return { id, result: { deleted: true } };
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

        case 'provider.auth.method': {
          return { id, result: {
            method: getActiveAuthMethod(),
            expired: getActiveAuthMethod() === 'dorabot_oauth' ? isOAuthTokenExpired() : false,
          } };
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
            const valid = ['default', 'acceptEdits', 'bypassPermissions', 'plan', 'dontAsk', 'delegate'];
            if (!valid.includes(value)) return { id, error: `permissionMode must be one of: ${valid.join(', ')}` };
            config.permissionMode = value as any;
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

          if (key === 'autonomy' && typeof value === 'string') {
            const valid = ['supervised', 'autonomous'];
            if (!valid.includes(value)) return { id, error: `autonomy must be one of: ${valid.join(', ')}` };
            config.autonomy = value as any;

            // sync permissionMode to match
            if (value === 'autonomous') {
              config.permissionMode = 'bypassPermissions';
              if (!config.security) config.security = {};
              config.security.approvalMode = 'autonomous';
            } else {
              config.permissionMode = 'default';
              if (!config.security) config.security = {};
              config.security.approvalMode = 'approve-sensitive';
            }

            // manage autonomous schedule
            if (scheduler) {
              const existing = scheduler.listItems().find(i => i.id === AUTONOMOUS_SCHEDULE_ID);
              if (value === 'autonomous' && !existing) {
                const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
                const item = buildAutonomousCalendarItem(tz);
                scheduler.addItem({ ...item, id: AUTONOMOUS_SCHEDULE_ID });
                console.log('[gateway] created autonomy pulse schedule');
              } else if (value === 'autonomous' && existing) {
                const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
                const desired = buildAutonomousCalendarItem(tz);
                scheduler.updateItem(AUTONOMOUS_SCHEDULE_ID, {
                  summary: desired.summary,
                  description: desired.description,
                  message: desired.message,
                  timezone: desired.timezone,
                  enabled: true,
                });
                console.log('[gateway] refreshed autonomy pulse schedule');
              } else if (value === 'supervised' && existing) {
                scheduler.removeItem(AUTONOMOUS_SCHEDULE_ID);
                console.log('[gateway] removed autonomy pulse schedule');
              }
            }

            saveConfig(config);
            broadcast({ event: 'config.update', data: { key, value } });
            return { id, result: { key, value } };
          }

          // provider config keys
          if (key === 'provider.name' && typeof value === 'string') {
            if (!['claude', 'codex', 'minimax'].includes(value)) {
              return { id, error: 'provider.name must be "claude", "codex", or "minimax"' };
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

          if (key === 'thinking') {
            // value: 'adaptive' | 'disabled' | null | { type: 'enabled', budgetTokens: number }
            if (value === null || value === undefined) {
              config.thinking = undefined;
            } else if (value === 'adaptive' || value === 'disabled') {
              config.thinking = value;
            } else if (typeof value === 'object' && (value as any).type === 'enabled' && typeof (value as any).budgetTokens === 'number') {
              config.thinking = value as any;
            } else {
              return { id, error: 'thinking must be "adaptive", "disabled", null, or { type: "enabled", budgetTokens: number }' };
            }
            saveConfig(config);
            broadcast({ event: 'config.update', data: { key, value } });
            return { id, result: { key, value } };
          }

          if (key === 'maxBudgetUsd') {
            if (value === null || value === undefined) {
              config.maxBudgetUsd = undefined;
            } else if (typeof value === 'number' && value > 0) {
              config.maxBudgetUsd = value;
            } else {
              return { id, error: 'maxBudgetUsd must be a positive number or null to clear' };
            }
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
          const tracked = clientWs ? watchedPathsByClient.get(clientWs) : undefined;
          if (!tracked?.has(resolvedWatch)) {
            startWatching(resolvedWatch);
            tracked?.add(resolvedWatch);
          }
          return { id, result: { watching: resolvedWatch } };
        }

        case 'fs.watch.stop': {
          const watchPath = params?.path as string;
          if (!watchPath) return { id, error: 'path required' };
          const resolvedWatch = resolve(watchPath);
          stopWatching(resolvedWatch);
          const tracked = clientWs ? watchedPathsByClient.get(clientWs) : undefined;
          tracked?.delete(resolvedWatch);
          return { id, result: { stopped: resolvedWatch } };
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
    clients.set(ws, { authenticated: false, subscriptions: new Set(), stale: new Set() });
    watchedPathsByClient.set(ws, new Set());
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
            const activeRunKeys = sessionRegistry.getActiveRunKeys();
            const hasActiveRun = activeRunKeys.length > 0;
            ws.send(JSON.stringify({
              event: 'status.update',
              data: {
                running: true,
                startedAt,
                activeRun: hasActiveRun,
                source: hasActiveRun ? activeRunKeys[0] : undefined,
                sessionKey: hasActiveRun ? activeRunKeys[0] : undefined,
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

      const response = await handleRpc(msg, ws);
      ws.send(JSON.stringify(response));
    });

    const releaseClientWatches = () => {
      const watched = watchedPathsByClient.get(ws);
      if (!watched) return;
      for (const p of watched) stopWatching(p);
      watchedPathsByClient.delete(ws);
    };

    ws.on('close', () => {
      releaseClientWatches();
      const batch = streamBatches.get(ws);
      if (batch?.timer) clearTimeout(batch.timer);
      streamBatches.delete(ws);
      clients.delete(ws);
      console.log(`[gateway] client disconnected (${clients.size} total)`);
    });

    ws.on('error', (err) => {
      console.error('[gateway] ws error:', err.message);
      releaseClientWatches();
      const batch = streamBatches.get(ws);
      if (batch?.timer) clearTimeout(batch.timer);
      streamBatches.delete(ws);
      clients.delete(ws);
    });
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.log(`[gateway] port ${port} in use, killing stale process...`);
        import('node:child_process').then(({ execSync }) => {
          try {
            execSync(`kill $(netstat -anv -p tcp 2>/dev/null | awk '/:${port} .* LISTEN/{print $9}') 2>/dev/null`);
          } catch {}
          setTimeout(() => {
            httpServer.listen(port, host, () => {
              console.log(`[gateway] listening on ${useTls ? 'wss' : 'ws'}://${host}:${port}`);
              resolve();
            });
          }, 500);
        });
      } else {
        reject(err);
      }
    });
    httpServer.listen(port, host, () => {
      console.log(`[gateway] listening on ${useTls ? 'wss' : 'ws'}://${host}:${port}`);
      resolve();
    });
  });

  // start channels
  await channelManager.startAll();

  return {
    close: async () => {
      clearInterval(backpressureTimer);
      clearInterval(eventCleanupTimer);
      for (const [, batch] of streamBatches) { if (batch.timer) clearTimeout(batch.timer); }
      streamBatches.clear();
      scheduler?.stop();
      await channelManager.stopAll();
      await disposeAllProviders();

      // close all file watchers
      for (const [path, entry] of fileWatchers) {
        if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
        const { watcher } = entry;
        watcher.close();
        console.log(`[gateway] closed watcher: ${path}`);
      }
      fileWatchers.clear();
      watchedPathsByClient.clear();

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
    scheduler,
    context,
  };
}
