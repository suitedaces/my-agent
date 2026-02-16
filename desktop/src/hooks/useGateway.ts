import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { jsonrepair } from 'jsonrepair';

/** Deep-set a dotted key path (e.g. "provider.codex.model") in an immutable object */
function setNestedKey(obj: Record<string, unknown>, key: string, value: unknown): Record<string, unknown> {
  const parts = key.split('.');
  if (parts.length === 1) return { ...obj, [key]: value };
  const [head, ...rest] = parts;
  const child = (obj[head] as Record<string, unknown>) || {};
  return { ...obj, [head]: setNestedKey({ ...child }, rest.join('.'), value) };
}

// strip mcp__<server>__ prefix from SDK tool names
function cleanToolName(name: string): string {
  if (!name.startsWith('mcp__')) return name;
  const idx = name.indexOf('__', 5);
  return idx >= 0 ? name.slice(idx + 2) : name;
}

const TOOL_PENDING_TEXT: Record<string, string> = {
  Read: 'reading file', Write: 'writing file', Edit: 'editing file',
  Glob: 'searching files', Grep: 'searching code', Bash: 'running command',
  WebFetch: 'fetching url', WebSearch: 'searching web', Task: 'running task',
  AskUserQuestion: 'asking question', TodoWrite: 'updating tasks',
  NotebookEdit: 'editing notebook', message: 'sending message',
  screenshot: 'taking screenshot', browser: 'using browser',
  schedule: 'scheduling', list_schedule: 'listing schedule',
  update_schedule: 'updating schedule', cancel_schedule: 'cancelling schedule',
};

export type ConnectionState = 'connecting' | 'connected' | 'disconnected';

// apply a raw stream event to a ChatItem array (works for top-level or subItems)
function applyStreamEvent(items: ChatItem[], evt: Record<string, unknown>): ChatItem[] {
  if (evt.type === 'content_block_start') {
    const cb = evt.content_block as Record<string, unknown>;
    if (!cb) return items;
    if (cb.type === 'text') return [...items, { type: 'text', content: '', streaming: true, timestamp: Date.now() }];
    if (cb.type === 'tool_use') return [...items, { type: 'tool_use', id: (cb.id as string) || '', name: cleanToolName((cb.name as string) || 'unknown'), input: '', streaming: true, timestamp: Date.now() }];
    if (cb.type === 'thinking') return [...items, { type: 'thinking', content: '', streaming: true, timestamp: Date.now() }];
  } else if (evt.type === 'content_block_delta') {
    const delta = evt.delta as Record<string, unknown>;
    if (!delta) return items;
    if (delta.type === 'text_delta' && typeof delta.text === 'string') {
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        if (it.type === 'text' && it.streaming) {
          const u = [...items];
          u[i] = { ...it, content: it.content + (delta.text as string) };
          return u;
        }
      }
    } else if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        if (it.type === 'tool_use' && it.streaming) {
          const u = [...items];
          u[i] = { ...it, input: it.input + (delta.partial_json as string) };
          return u;
        }
      }
    } else if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string') {
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        if (it.type === 'thinking' && it.streaming) {
          const u = [...items];
          u[i] = { ...it, content: it.content + (delta.thinking as string) };
          return u;
        }
      }
    }
  } else if (evt.type === 'content_block_stop') {
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if ('streaming' in it && it.streaming) {
        // tool_use: content_block_stop means input JSON is complete, NOT that the
        // tool finished executing.  Keep streaming:true until agent.tool_result.
        if (it.type === 'tool_use') return items;
        const u = [...items];
        u[i] = { ...it, streaming: false };
        return u;
      }
    }
  }
  return items;
}

export type ChatItem =
  | { type: 'user'; content: string; timestamp: number }
  | { type: 'text'; content: string; streaming?: boolean; timestamp: number }
  | { type: 'tool_use'; id: string; name: string; input: string; output?: string; imageData?: string; is_error?: boolean; streaming?: boolean; subItems?: ChatItem[]; timestamp: number }
  | { type: 'thinking'; content: string; streaming?: boolean; timestamp: number }
  | { type: 'result'; cost?: number; timestamp: number }
  | { type: 'error'; content: string; timestamp: number };

export type ProgressItem = { content: string; status: 'pending' | 'in_progress' | 'completed'; activeForm: string };

export type ChannelMessage = {
  id: string;
  channel: string;
  chatId: string;
  senderId: string;
  senderName?: string;
  body: string;
  timestamp: number;
  response?: string;
};

export type ChannelStatusInfo = {
  channel: string;
  accountId: string;
  running: boolean;
  connected: boolean;
  lastError: string | null;
};

export type SessionInfo = {
  id: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
  channel?: string;
  chatId?: string;
  chatType?: string;
  senderName?: string;
  preview?: string;
  activeRun?: boolean;
};

export type AskUserQuestion = {
  requestId: string;
  questions: Array<{
    question: string;
    header: string;
    options: Array<{ label: string; description: string }>;
    multiSelect: boolean;
  }>;
};

export type ToolApproval = {
  requestId: string;
  toolName: string;
  input: Record<string, unknown>;
  tier: string;
  sessionKey?: string;
  timestamp: number;
};

export type ToolNotification = {
  toolName: string;
  input: Record<string, unknown>;
  tier: string;
  timestamp: number;
};

export type NotifiableEvent =
  | { type: 'agent.result'; sessionKey: string; cost?: number }
  | { type: 'agent.error'; sessionKey: string; error: string }
  | { type: 'tool_approval'; toolName: string }
  | { type: 'goals.update' }
  | { type: 'research.update' }
  | { type: 'whatsapp.status'; status: string }
  | { type: 'telegram.status'; status: string }
  | { type: 'calendar'; summary: string };

export type BackgroundRun = {
  id: string;
  sessionKey: string;
  prompt: string;
  startedAt: number;
  status: 'running' | 'completed' | 'error';
  result?: string;
  error?: string;
};

export type CalendarRun = {
  item: string;
  summary: string;
  status: string;
  result?: string;
  sessionId?: string;
  usage?: { inputTokens: number; outputTokens: number; totalCostUsd: number };
  durationMs?: number;
  messaged?: boolean;
  timestamp: number;
  seen?: boolean;
};

export type SessionState = {
  chatItems: ChatItem[];
  agentStatus: string;
  sessionId?: string;
  pendingQuestion: AskUserQuestion | null;
};

const DEFAULT_SESSION_STATE: SessionState = {
  chatItems: [],
  agentStatus: 'idle',
  pendingQuestion: null,
};

type RpcResponse = {
  id: number;
  result?: unknown;
  error?: string;
};

type GatewayEvent = {
  event: string;
  data: unknown;
};

type PendingRpc = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
};

type SessionMessage = {
  type: 'user' | 'assistant' | 'system' | 'result';
  uuid?: string;
  timestamp: string;
  content: Record<string, unknown>;
};

function sessionMessagesToChatItems(messages: SessionMessage[]): ChatItem[] {
  const items: ChatItem[] = [];
  // Track active Task tool scopes — messages between a Task tool_use and its
  // matching tool_result are subagent content that should be nested as subItems.
  const activeTaskIds = new Set<string>();
  const taskSubItems = new Map<string, ChatItem[]>();

  const extractResultText = (block: any): string => {
    if (typeof block.content === 'string') return block.content;
    if (Array.isArray(block.content)) {
      return block.content
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('\n');
    }
    return '';
  };

  for (const msg of messages) {
    const c = msg.content;
    const ts = new Date(msg.timestamp).getTime();

    if (msg.type === 'system') continue;

    if (msg.type === 'user') {
      const userMsg = (c as any).message;
      const parentToolUseId = (c as any).parent_tool_use_id as string | undefined;
      const blocks = userMsg?.content;
      const hasToolResult = Array.isArray(blocks) && blocks.some((b: any) => b.type === 'tool_result');

      if (hasToolResult) {
        if (Array.isArray(blocks)) {
          for (const block of blocks) {
            if (block.type !== 'tool_result') continue;
            const resultText = extractResultText(block);
            const toolUseId = block.tool_use_id as string;

            // Check if this is the final result for a Task tool
            if (activeTaskIds.has(toolUseId)) {
              activeTaskIds.delete(toolUseId);
              const subs = taskSubItems.get(toolUseId) || [];
              taskSubItems.delete(toolUseId);
              const trimmed = resultText.slice(0, 2000);

              for (let i = items.length - 1; i >= 0; i--) {
                const it = items[i];
                if (it.type === 'tool_use' && it.id === toolUseId) {
                  items[i] = { ...it, output: trimmed, is_error: block.is_error || false, subItems: subs.length > 0 ? subs : trimmed ? [{ type: 'text' as const, content: trimmed, timestamp: it.timestamp }] : undefined };
                  break;
                }
              }
              continue;
            }

            // Subagent tool result — patch onto the subItems list
            if (parentToolUseId && activeTaskIds.has(parentToolUseId)) {
              const subs = taskSubItems.get(parentToolUseId);
              if (subs) {
                for (let i = subs.length - 1; i >= 0; i--) {
                  const si = subs[i];
                  if (si.type === 'tool_use' && si.id === toolUseId) {
                    subs[i] = { ...si, output: resultText.slice(0, 1000), is_error: block.is_error || false };
                    break;
                  }
                }
              }
              continue;
            }

            // Regular (non-Task) tool result — patch top-level items
            for (let i = items.length - 1; i >= 0; i--) {
              const it = items[i];
              if (it.type === 'tool_use' && it.id === toolUseId) {
                items[i] = { ...it, output: resultText.slice(0, 2000), is_error: block.is_error || false };
                break;
              }
            }
          }
        }
      } else if (activeTaskIds.size > 0) {
        // Subagent prompt or intermediate user message — skip from top-level
        continue;
      } else {
        // real user message
        let text = '';
        if (typeof blocks === 'string') {
          text = blocks;
        } else if (Array.isArray(blocks)) {
          text = blocks
            .filter((b: any) => b.type === 'text')
            .map((b: any) => b.text)
            .join('\n');
        }
        if (text) {
          items.push({ type: 'user', content: text, timestamp: ts });
        }
      }
      continue;
    }

    if (msg.type === 'assistant') {
      const assistantMsg = (c as any).message;
      const blocks = assistantMsg?.content;

      // If we're inside a Task scope, route blocks into subItems
      if (activeTaskIds.size > 0) {
        const taskId = [...activeTaskIds].at(-1)!;
        const subs = taskSubItems.get(taskId) || [];
        if (Array.isArray(blocks)) {
          for (const block of blocks) {
            if (block.type === 'text' && block.text) {
              subs.push({ type: 'text', content: block.text, timestamp: ts });
            } else if (block.type === 'tool_use') {
              subs.push({
                type: 'tool_use',
                id: block.id || '',
                name: cleanToolName(block.name || 'unknown'),
                input: typeof block.input === 'string' ? block.input : JSON.stringify(block.input || {}),
                timestamp: ts,
              });
            }
          }
        }
        taskSubItems.set(taskId, subs);
        continue;
      }

      if (Array.isArray(blocks)) {
        for (const block of blocks) {
          if (block.type === 'text' && block.text) {
            items.push({ type: 'text', content: block.text, timestamp: ts });
          } else if (block.type === 'tool_use') {
            const name = cleanToolName(block.name || 'unknown');
            const item: ChatItem = {
              type: 'tool_use',
              id: block.id || '',
              name,
              input: typeof block.input === 'string' ? block.input : JSON.stringify(block.input || {}),
              timestamp: ts,
            };
            items.push(item);

            // If this is a Task tool, start collecting subagent messages
            if (name === 'Task') {
              activeTaskIds.add(block.id);
              taskSubItems.set(block.id, []);
            }
          } else if (block.type === 'thinking' && block.thinking) {
            items.push({ type: 'thinking', content: block.thinking, timestamp: ts });
          }
        }
      }
      continue;
    }

    if (msg.type === 'result') {
      items.push({
        type: 'result',
        cost: (c as any).total_cost_usd,
        timestamp: ts,
      });
    }
  }

  return items;
}

// Token consumed once from preload, cached in module scope — not re-extractable
let cachedToken: string | null = null;
function getToken(): string {
  if (!cachedToken) {
    cachedToken = (window as any).electronAPI?.consumeGatewayToken?.()
      || localStorage.getItem('dorabot:gateway-token')
      || '';
  }
  return cachedToken ?? '';
}

// Helper: update a single session's chatItems in the map
function updateSessionChatItems(
  prev: Record<string, SessionState>,
  sk: string,
  updater: (items: ChatItem[]) => ChatItem[],
): Record<string, SessionState> {
  const state = prev[sk];
  if (!state) return prev;
  const newItems = updater(state.chatItems);
  if (newItems === state.chatItems) return prev;
  return { ...prev, [sk]: { ...state, chatItems: newItems } };
}

export function useGateway(url = 'wss://localhost:18789') {
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');

  // Multi-session state: all tracked sessions' state keyed by sessionKey
  const [sessionStates, setSessionStates] = useState<Record<string, SessionState>>({});
  // Which session is currently active (displayed in the focused tab)
  const [activeSessionKey, setActiveSessionKey] = useState<string>('');

  const [channelMessages, setChannelMessages] = useState<ChannelMessage[]>([]);
  const [channelStatuses, setChannelStatuses] = useState<ChannelStatusInfo[]>([]);
  const [model, setModel] = useState<string>('');
  const [configData, setConfigData] = useState<Record<string, unknown> | null>(null);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<ToolApproval[]>([]);
  const [notifications, setNotifications] = useState<ToolNotification[]>([]);
  const [whatsappQr, setWhatsappQr] = useState<string | null>(null);
  const [whatsappLoginStatus, setWhatsappLoginStatus] = useState<string>('unknown');
  const [whatsappLoginError, setWhatsappLoginError] = useState<string | null>(null);
  const [telegramLinkStatus, setTelegramLinkStatus] = useState<string>('unknown');
  const [telegramBotUsername, setTelegramBotUsername] = useState<string | null>(null);
  const [telegramLinkError, setTelegramLinkError] = useState<string | null>(null);
  const [providerInfo, setProviderInfo] = useState<{ name: string; auth: { authenticated: boolean; method?: string; identity?: string; error?: string; model?: string; cliVersion?: string; permissionMode?: string } } | null>(null);
  const [goalsVersion, setGoalsVersion] = useState(0);
  const [researchVersion, setResearchVersion] = useState(0);
  const [backgroundRuns, setBackgroundRuns] = useState<BackgroundRun[]>([]);
  const [calendarRuns, setCalendarRuns] = useState<CalendarRun[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const rpcIdRef = useRef(0);
  const pendingRpcRef = useRef(new Map<number, PendingRpc>());
  const reconnectTimerRef = useRef<number | null>(null);
  const fsChangeListenersRef = useRef<Set<(path: string) => void>>(new Set());

  // Refs for event handler (doesn't close over state)
  const activeSessionKeyRef = useRef<string>('');
  const currentChatIdRef = useRef<string>(`task-${Date.now()}`);
  const trackedSessionsRef = useRef<Set<string>>(new Set());
  const lastSeqRef = useRef<number>(0);
  // Callback ref for tab system to be notified of sessionId changes
  const onSessionIdChangeRef = useRef<((sessionKey: string, sessionId: string) => void) | null>(null);
  const onNotifiableEventRef = useRef<((event: NotifiableEvent) => void) | null>(null);

  const rpc = useCallback(async (method: string, params?: Record<string, unknown>, timeoutMs = 30000): Promise<unknown> => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected to gateway');
    }

    const id = ++rpcIdRef.current;
    return new Promise((resolve, reject) => {
      pendingRpcRef.current.set(id, { resolve, reject });
      ws.send(JSON.stringify({ method, params, id }));

      // timeout after default 30s unless caller overrides
      setTimeout(() => {
        if (pendingRpcRef.current.has(id)) {
          pendingRpcRef.current.delete(id);
          reject(new Error(`RPC timeout: ${method}`));
        }
      }, timeoutMs);
    });
  }, []);

  // --- Session tracking ---

  const pendingSubscribeRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const trackSession = useCallback((sessionKey: string) => {
    trackedSessionsRef.current.add(sessionKey);
    setSessionStates(prev => {
      if (prev[sessionKey]) return prev;
      return { ...prev, [sessionKey]: { ...DEFAULT_SESSION_STATE } };
    });
    rpc('sessions.subscribe', { sessionKeys: [sessionKey], lastSeq: lastSeqRef.current }).catch(() => {});
  }, [rpc]);

  const untrackSession = useCallback((sessionKey: string) => {
    trackedSessionsRef.current.delete(sessionKey);
    setSessionStates(prev => {
      if (!prev[sessionKey]) return prev;
      const { [sessionKey]: _, ...rest } = prev;
      return rest;
    });
    rpc('sessions.unsubscribe', { sessionKeys: [sessionKey] }).catch(() => {});
  }, [rpc]);

  const trackSessionDebounced = useCallback((sessionKey: string, prevKey?: string) => {
    trackedSessionsRef.current.add(sessionKey);
    setSessionStates(prev => {
      if (prev[sessionKey]) return prev;
      return { ...prev, [sessionKey]: { ...DEFAULT_SESSION_STATE } };
    });
    if (pendingSubscribeRef.current) clearTimeout(pendingSubscribeRef.current);
    pendingSubscribeRef.current = setTimeout(() => {
      if (prevKey) rpc('sessions.unsubscribe', { sessionKeys: [prevKey] }).catch(() => {});
      rpc('sessions.subscribe', { sessionKeys: [sessionKey], lastSeq: lastSeqRef.current }).catch(() => {});
      pendingSubscribeRef.current = null;
    }, 100);
  }, [rpc]);

  const setActiveSession = useCallback((sessionKey: string, chatId: string) => {
    activeSessionKeyRef.current = sessionKey;
    currentChatIdRef.current = chatId;
    setActiveSessionKey(sessionKey);
  }, []);

  const loadSessionIntoMap = useCallback(async (sessionId: string, sessionKey: string, chatId?: string) => {
    try {
      const res = await rpc('sessions.get', { sessionId }) as { sessionId: string; messages: SessionMessage[] };
      if (res?.messages) {
        const items = sessionMessagesToChatItems(res.messages);
        setSessionStates(prev => ({
          ...prev,
          [sessionKey]: {
            ...(prev[sessionKey] || DEFAULT_SESSION_STATE),
            chatItems: items,
            sessionId,
          },
        }));
        // restore registry entry so next chat.send continues this conversation
        rpc('sessions.resume', { sessionId, chatId }).catch((err: unknown) => {
          console.warn('failed to resume session in registry:', err);
        });
      }
    } catch (err) {
      console.error('failed to load session into map:', err);
    }
  }, [rpc]);

  // --- Stream event batching (apply all queued deltas in one React update per frame) ---
  type QueuedStreamEvent = { sk: string; evt: Record<string, unknown>; parentId?: string | null };
  const streamQueueRef = useRef<QueuedStreamEvent[]>([]);
  const streamRafRef = useRef<number | null>(null);

  const flushStreamQueue = useCallback(() => {
    streamRafRef.current = null;
    const queue = streamQueueRef.current;
    if (!queue.length) return;
    streamQueueRef.current = [];

    setSessionStates(prev => {
      let next = prev;
      for (const { sk, evt, parentId } of queue) {
        if (parentId) {
          next = updateSessionChatItems(next, sk, items => {
            for (let i = items.length - 1; i >= 0; i--) {
              const it = items[i];
              if (it.type === 'tool_use' && it.id === parentId) {
                const updated = [...items];
                updated[i] = { ...it, subItems: applyStreamEvent(it.subItems || [], evt) };
                return updated;
              }
            }
            return items;
          });
        } else {
          next = updateSessionChatItems(next, sk, items => applyStreamEvent(items, evt));
        }
      }
      return next;
    });
  }, []);

  // --- Event handling (routes to all tracked sessions) ---

  const handleEvent = useCallback((event: GatewayEvent) => {
    const { event: name, data } = event;

    switch (name) {
      case 'agent.user_message': {
        const d = data as { source: string; sessionKey?: string; prompt: string; injected?: boolean; timestamp: number };
        const sk = d.sessionKey;
        if (!sk || !trackedSessionsRef.current.has(sk)) break;
        // desktop/chat already adds user item in sendMessage, skip to avoid dupes
        if (d.source !== 'desktop/chat') {
          setSessionStates(prev => {
            const state = prev[sk];
            if (!state) return prev;
            return {
              ...prev,
              [sk]: {
                ...state,
                chatItems: [...state.chatItems, { type: 'user', content: d.prompt, timestamp: d.timestamp || Date.now() }],
                agentStatus: state.agentStatus === 'idle' ? 'thinking...' : state.agentStatus,
              },
            };
          });
        }
        break;
      }

      case 'agent.tool_use': {
        const d = data as { source: string; sessionKey?: string; tool: string; timestamp: number };
        const sk = d.sessionKey;
        if (!sk || !trackedSessionsRef.current.has(sk)) break;
        setSessionStates(prev => {
          const state = prev[sk];
          if (!state) return prev;
          return { ...prev, [sk]: { ...state, agentStatus: `${TOOL_PENDING_TEXT[d.tool] || `running ${d.tool}`}...` } };
        });
        break;
      }

      case 'agent.stream': {
        const d = data as { source: string; sessionKey?: string; event: Record<string, unknown>; parentToolUseId?: string | null; timestamp: number };
        const sk = d.sessionKey;
        if (!sk || !trackedSessionsRef.current.has(sk)) break;
        const evt = d.event;
        if (!evt) break;

        // batch stream events, flush once per animation frame
        streamQueueRef.current.push({ sk, evt, parentId: d.parentToolUseId });
        if (streamRafRef.current === null) {
          streamRafRef.current = requestAnimationFrame(flushStreamQueue);
        }
        break;
      }

      case 'agent.result': {
        const d = data as { sessionKey?: string; sessionId: string; result: string; usage?: { totalCostUsd?: number } };
        const sk = d.sessionKey;
        if (!sk || !trackedSessionsRef.current.has(sk)) break;
        // flush any pending stream deltas before marking streaming:false
        if (streamRafRef.current !== null) {
          cancelAnimationFrame(streamRafRef.current);
          streamRafRef.current = null;
        }
        flushStreamQueue();
        setSessionStates(prev => {
          const state = prev[sk];
          if (!state) return prev;
          const updated = state.chatItems.map(item => {
            let it = item;
            if ('streaming' in it && it.streaming) it = { ...it, streaming: false };
            if (it.type === 'tool_use' && it.subItems?.length) {
              const subs = it.subItems.map(s =>
                'streaming' in s && s.streaming ? { ...s, streaming: false } : s
              );
              it = { ...it, subItems: subs };
            }
            return it;
          });
          updated.push({ type: 'result', cost: d.usage?.totalCostUsd, timestamp: Date.now() });
          return {
            ...prev,
            [sk]: { ...state, chatItems: updated, agentStatus: 'idle', pendingQuestion: null, sessionId: d.sessionId || state.sessionId },
          };
        });
        // Notify tab system of sessionId assignment
        if (d.sessionId && onSessionIdChangeRef.current) {
          onSessionIdChangeRef.current(sk, d.sessionId);
        }
        onNotifiableEventRef.current?.({ type: 'agent.result', sessionKey: sk, cost: d.usage?.totalCostUsd });
        break;
      }

      case 'agent.error': {
        const d = data as { sessionKey?: string; error: string };
        const sk = d.sessionKey;
        if (!sk || !trackedSessionsRef.current.has(sk)) break;
        setSessionStates(prev => {
          const state = prev[sk];
          if (!state) return prev;
          return {
            ...prev,
            [sk]: {
              ...state,
              chatItems: [...state.chatItems, { type: 'error', content: d.error, timestamp: Date.now() }],
              agentStatus: 'idle',
              pendingQuestion: null,
            },
          };
        });
        onNotifiableEventRef.current?.({ type: 'agent.error', sessionKey: sk, error: d.error });
        break;
      }

      case 'agent.ask_user': {
        const d = data as { requestId: string; sessionKey?: string; questions: AskUserQuestion['questions']; timestamp: number };
        const sk = d.sessionKey;
        if (sk && trackedSessionsRef.current.has(sk)) {
          setSessionStates(prev => {
            const state = prev[sk];
            if (!state) return prev;
            return {
              ...prev,
              [sk]: {
                ...state,
                pendingQuestion: { requestId: d.requestId, questions: d.questions },
                agentStatus: 'waiting for input...',
              },
            };
          });
        }
        break;
      }

      case 'agent.question_dismissed': {
        const d = data as { requestId: string; sessionKey?: string; reason: string };
        const sk = d.sessionKey;
        if (sk && trackedSessionsRef.current.has(sk)) {
          setSessionStates(prev => {
            const state = prev[sk];
            if (!state || state.pendingQuestion?.requestId !== d.requestId) return prev;
            return { ...prev, [sk]: { ...state, pendingQuestion: null } };
          });
        }
        break;
      }

      case 'agent.message': {
        // Full assistant messages — from non-streaming providers (Codex) or subagent turns.
        const d = data as { source: string; sessionKey?: string; message: Record<string, unknown>; parentToolUseId?: string | null; timestamp: number };
        const sk = d.sessionKey;
        if (!sk || !trackedSessionsRef.current.has(sk)) break;
        const parentId = d.parentToolUseId;
        const assistantMsg = d.message?.message as Record<string, unknown>;
        const content = assistantMsg?.content as unknown[];

        if (parentId && Array.isArray(content)) {
          // subagent message — route tool_use and text blocks into parent Task's subItems
          setSessionStates(prev => updateSessionChatItems(prev, sk, items => {
            for (let i = items.length - 1; i >= 0; i--) {
              const it = items[i];
              if (it.type === 'tool_use' && it.id === parentId) {
                const subs = [...(it.subItems || [])];
                for (const block of content) {
                  const b = block as Record<string, unknown>;
                  if (b.type === 'tool_use') {
                    subs.push({
                      type: 'tool_use', id: (b.id as string) || '',
                      name: cleanToolName((b.name as string) || 'unknown'),
                      input: typeof b.input === 'string' ? b.input : JSON.stringify(b.input || {}),
                      streaming: true, timestamp: d.timestamp || Date.now(),
                    });
                  } else if (b.type === 'text' && typeof b.text === 'string') {
                    subs.push({ type: 'text', content: b.text as string, streaming: false, timestamp: d.timestamp || Date.now() });
                  }
                }
                const updated = [...items];
                updated[i] = { ...it, subItems: subs };
                return updated;
              }
            }
            return items;
          }));
          break;
        }

        // top-level assistant message (non-streaming provider like Codex)
        if (Array.isArray(content)) {
          setSessionStates(prev => updateSessionChatItems(prev, sk, items => {
            const updated = [...items];
            for (const block of content) {
              const b = block as Record<string, unknown>;
              if (b.type === 'text' && typeof b.text === 'string') {
                updated.push({ type: 'text', content: b.text as string, streaming: false, timestamp: d.timestamp || Date.now() });
              } else if (b.type === 'tool_use') {
                updated.push({
                  type: 'tool_use',
                  id: (b.id as string) || '',
                  name: cleanToolName((b.name as string) || 'unknown'),
                  input: typeof b.input === 'string' ? b.input : JSON.stringify(b.input || {}),
                  streaming: true,
                  timestamp: d.timestamp || Date.now(),
                });
              } else if (b.type === 'thinking' && typeof b.thinking === 'string') {
                updated.push({ type: 'thinking', content: b.thinking as string, streaming: false, timestamp: d.timestamp || Date.now() });
              }
            }
            return updated;
          }));
        }
        break;
      }

      case 'agent.tool_result': {
        const d = data as { sessionKey?: string; tool_use_id: string; toolName?: string; content: string; imageData?: string; is_error?: boolean; parentToolUseId?: string | null };
        const sk = d.sessionKey;
        if (!sk || !trackedSessionsRef.current.has(sk)) break;
        setSessionStates(prev => updateSessionChatItems(prev, sk, items => {
          // subagent tool result
          if (d.parentToolUseId) {
            for (let i = items.length - 1; i >= 0; i--) {
              const it = items[i];
              if (it.type === 'tool_use' && it.id === d.parentToolUseId) {
                const subs = it.subItems || [];
                // try to find existing tool_use subItem
                for (let j = subs.length - 1; j >= 0; j--) {
                  const sub = subs[j];
                  if (sub.type === 'tool_use' && sub.id === d.tool_use_id) {
                    const updated = [...items];
                    const newSubs = [...subs];
                    newSubs[j] = { ...sub, output: d.content, imageData: d.imageData, is_error: d.is_error, streaming: false };
                    updated[i] = { ...it, subItems: newSubs };
                    return updated;
                  }
                }
                // no matching tool_use — create synthetic one with result
                const updated = [...items];
                const newSub: ChatItem = {
                  type: 'tool_use', id: d.tool_use_id, name: d.toolName || 'tool',
                  input: '', output: d.content, imageData: d.imageData,
                  is_error: d.is_error, streaming: false, timestamp: Date.now(),
                };
                updated[i] = { ...it, subItems: [...subs, newSub] };
                return updated;
              }
            }
          }
          // top-level tool result
          let idx = -1;
          for (let i = items.length - 1; i >= 0; i--) {
            const it = items[i];
            if (it.type === 'tool_use' && it.id === d.tool_use_id) { idx = i; break; }
          }
          if (idx >= 0) {
            const updated = [...items];
            const item = updated[idx] as Extract<ChatItem, { type: 'tool_use' }>;
            updated[idx] = { ...item, output: d.content, imageData: d.imageData, is_error: d.is_error, streaming: false };
            return updated;
          }
          return items;
        }));
        break;
      }

      case 'session.snapshot': {
        const snap = data as {
          sessionKey: string;
          status: string;
          text: string;
          currentTool: { name: string; inputJson: string } | null;
          completedTools: { name: string; detail: string }[];
          pendingApproval: { requestId: string; toolName: string; input: Record<string, unknown>; timestamp: number } | null;
          pendingQuestion: { requestId: string; questions: any[] } | null;
          updatedAt: number;
        };
        const sk = snap.sessionKey;
        if (!sk || !trackedSessionsRef.current.has(sk)) break;
        setSessionStates(prev => {
          const state = prev[sk];
          if (!state) return prev;
          const items: ChatItem[] = [];
          for (const tool of snap.completedTools) {
            items.push({ type: 'tool_use', id: '', name: tool.name, input: '', output: '', streaming: false, timestamp: snap.updatedAt });
          }
          if (snap.currentTool) {
            items.push({ type: 'tool_use', id: '', name: snap.currentTool.name, input: snap.currentTool.inputJson, streaming: true, timestamp: snap.updatedAt });
          }
          if (snap.text) {
            items.push({ type: 'text', content: snap.text, streaming: snap.status === 'responding', timestamp: snap.updatedAt });
          }
          const lastResultIdx = state.chatItems.map(i => i.type).lastIndexOf('result');
          const replaceFrom = state.chatItems.findIndex((it, idx) => idx > lastResultIdx && it.type !== 'user');
          const base = replaceFrom >= 0 ? state.chatItems.slice(0, replaceFrom) : state.chatItems;
          return {
            ...prev,
            [sk]: {
              ...state,
              chatItems: [...base, ...items],
              agentStatus: snap.status,
              pendingQuestion: snap.pendingQuestion ? { requestId: snap.pendingQuestion.requestId, questions: snap.pendingQuestion.questions } : null,
            },
          };
        });
        setPendingApprovals(prev => {
          const withoutSession = prev.filter(a => a.sessionKey !== sk);
          if (!snap.pendingApproval) return withoutSession;
          return [...withoutSession, {
            requestId: snap.pendingApproval.requestId,
            toolName: snap.pendingApproval.toolName,
            input: snap.pendingApproval.input,
            tier: 'require-approval',
            sessionKey: sk,
            timestamp: snap.pendingApproval.timestamp,
          }];
        });
        break;
      }

      case 'agent.status': {
        const d = data as { sessionKey: string; status: string; toolName?: string; toolDetail?: string };
        const sk = d.sessionKey;
        if (!sk || !trackedSessionsRef.current.has(sk)) break;
        setSessionStates(prev => {
          const state = prev[sk];
          if (!state) return prev;
          let statusText = d.status;
          if (d.status === 'tool_use' && d.toolName) {
            statusText = `${TOOL_PENDING_TEXT[d.toolName] || `running ${d.toolName}`}...`;
          } else if (d.status === 'responding') {
            statusText = 'responding...';
          } else if (d.status === 'thinking') {
            statusText = 'thinking...';
          }
          return { ...prev, [sk]: { ...state, agentStatus: statusText } };
        });
        break;
      }

      case 'agent.stream_batch': {
        const events = data as any[];
        for (const evt of events) {
          if (evt && typeof evt === 'object') {
            const seq = (evt as { seq?: unknown }).seq;
            if (typeof seq === 'number' && seq > lastSeqRef.current) {
              lastSeqRef.current = seq;
            }
          }
          if (evt && typeof evt === 'object' && 'event' in evt && 'data' in evt) {
            handleEvent(evt as GatewayEvent);
          } else {
            handleEvent({ event: 'agent.stream', data: evt });
          }
        }
        break;
      }

      case 'channel.message': {
        const d = data as ChannelMessage;
        setChannelMessages(prev => [...prev.slice(-500), d]);
        break;
      }

      case 'channel.status': {
        const d = data as ChannelStatusInfo;
        setChannelStatuses(prev => {
          const idx = prev.findIndex(s => s.channel === d.channel);
          if (idx >= 0) {
            const updated = [...prev];
            updated[idx] = d;
            return updated;
          }
          return [...prev, d];
        });
        break;
      }

      case 'status.update': {
        const d = data as { activeRun?: boolean; source?: string; sessionKey?: string; model?: string };
        if (d.model) setModel(d.model);
        const sk = d.sessionKey;
        if (sk && trackedSessionsRef.current.has(sk)) {
          setSessionStates(prev => {
            const state = prev[sk];
            if (!state) return prev;
            const newStatus = d.activeRun ? `running (${d.source || 'agent'})` : 'idle';
            if (state.agentStatus === newStatus && !(newStatus === 'idle' && state.pendingQuestion)) return prev;
            return { ...prev, [sk]: { ...state, agentStatus: newStatus, ...(newStatus === 'idle' ? { pendingQuestion: null } : {}) } };
          });
        }
        break;
      }

      case 'session.update': {
        const d = data as SessionInfo;
        if (!d.id) break;
        setSessions(prev => {
          const idx = prev.findIndex(s => s.id === d.id);
          if (idx >= 0) {
            const existing = prev[idx];
            // skip if nothing actually changed (avoid rerender)
            if (existing.activeRun === d.activeRun && existing.messageCount === d.messageCount) return prev;
            const updated = [...prev];
            updated[idx] = { ...existing, ...d };
            return updated;
          }
          return [d, ...prev];
        });
        break;
      }

      case 'config.update': {
        const d = data as { key: string; value: unknown };
        setConfigData(prev => prev ? setNestedKey(prev, d.key, d.value) : prev);
        break;
      }

      case 'agent.tool_approval': {
        const d = data as ToolApproval;
        setPendingApprovals(prev => [...prev, d]);
        onNotifiableEventRef.current?.({ type: 'tool_approval', toolName: cleanToolName(d.toolName) });
        break;
      }

      case 'agent.tool_notify': {
        const d = data as ToolNotification;
        setNotifications(prev => [...prev.slice(-20), d]);
        setTimeout(() => {
          setNotifications(prev => prev.filter(n => n.timestamp !== d.timestamp));
        }, 5000);
        break;
      }

      case 'goals.update': {
        setGoalsVersion(v => v + 1);
        onNotifiableEventRef.current?.({ type: 'goals.update' });
        break;
      }

      case 'research.update': {
        setResearchVersion(v => v + 1);
        onNotifiableEventRef.current?.({ type: 'research.update' });
        break;
      }

      case 'background.status': {
        const d = data as BackgroundRun;
        setBackgroundRuns(prev => {
          const idx = prev.findIndex(r => r.id === d.id);
          if (idx >= 0) {
            const updated = [...prev];
            updated[idx] = d;
            return updated;
          }
          return [...prev, d];
        });
        break;
      }

      case 'fs.change': {
        const d = data as { path: string; eventType: string; filename: string | null };
        fsChangeListenersRef.current.forEach(listener => listener(d.path));
        break;
      }

      case 'calendar.result': {
        const d = data as CalendarRun;
        onNotifiableEventRef.current?.({ type: 'calendar', summary: d.summary || d.item });
        setCalendarRuns(prev => [{ ...d, seen: false }, ...prev].slice(0, 50));
        break;
      }

      case 'whatsapp.qr': {
        const d = data as { qr: string };
        setWhatsappQr(d.qr);
        break;
      }

      case 'whatsapp.login_status': {
        const d = data as { status: string; error?: string };
        setWhatsappLoginStatus(d.status);
        if (d.status === 'failed') {
          setWhatsappLoginError(d.error || 'WhatsApp login failed');
          setWhatsappQr(null);
          onNotifiableEventRef.current?.({ type: 'whatsapp.status', status: 'failed' });
          break;
        }
        if (d.status === 'connecting' || d.status === 'qr_ready' || d.status === 'connected' || d.status === 'disconnected' || d.status === 'not_linked') {
          setWhatsappLoginError(null);
        }
        if (d.status === 'connected' || d.status === 'failed' || d.status === 'disconnected') {
          setWhatsappQr(null);
        }
        if (d.status === 'connected' || d.status === 'disconnected') {
          onNotifiableEventRef.current?.({ type: 'whatsapp.status', status: d.status });
        }
        break;
      }

      case 'telegram.link_status': {
        const d = data as { status: string; botUsername?: string };
        if (d.status === 'linked') {
          setTelegramLinkStatus('linked');
          setTelegramBotUsername(d.botUsername || null);
          setTelegramLinkError(null);
          onNotifiableEventRef.current?.({ type: 'telegram.status', status: 'linked' });
        } else if (d.status === 'unlinked') {
          setTelegramLinkStatus('unlinked');
          setTelegramBotUsername(null);
          setTelegramLinkError(null);
          onNotifiableEventRef.current?.({ type: 'telegram.status', status: 'unlinked' });
        }
        break;
      }

      case 'provider.auth_complete': {
        const d = data as { provider: string; status: { authenticated: boolean; method?: string; identity?: string; error?: string; model?: string; cliVersion?: string; permissionMode?: string } };
        setProviderInfo(prev => prev ? { ...prev, auth: d.status } : { name: d.provider, auth: d.status });
        break;
      }
    }
  }, [flushStreamQueue]);

  const connect = useCallback(() => {
    // close any existing connection first
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
      wsRef.current = null;
    }

    setConnectionState('connecting');
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      if (wsRef.current !== ws) return;

      const token = getToken();
      console.log('[gateway] auth token:', token ? `${token.slice(0, 8)}...` : 'MISSING');
      if (token) {
        const authId = ++rpcIdRef.current;
        ws.send(JSON.stringify({ method: 'auth', params: { token, lastSeq: lastSeqRef.current }, id: authId }));
        pendingRpcRef.current.set(authId, {
          resolve: () => {
            setConnectionState('connected');
            // re-subscribe all tracked sessions
            const tracked = Array.from(trackedSessionsRef.current);
            if (tracked.length > 0) {
              rpc('sessions.subscribe', { sessionKeys: tracked, lastSeq: lastSeqRef.current }).catch(() => {});
            }
            rpc('config.get').then((res) => {
              const c = res as Record<string, unknown>;
              setConfigData(c);
              if (c.model) setModel(c.model as string);
            }).catch(() => {});
            rpc('provider.get').then((res) => {
              const p = res as { name: string; auth: { authenticated: boolean; method?: string; identity?: string; error?: string; model?: string; cliVersion?: string; permissionMode?: string } };
              setProviderInfo(p);
            }).catch(() => {});
            rpc('sessions.list').then((res) => {
              const arr = res as SessionInfo[];
              if (Array.isArray(arr)) setSessions(arr);
            }).catch(() => {});
            rpc('channels.status').then((res) => {
              const arr = res as ChannelStatusInfo[];
              if (Array.isArray(arr)) setChannelStatuses(arr);
            }).catch(() => {});
            // Tab system handles session restoration — no auto-restore here
          },
          reject: (err) => {
            console.error('auth failed:', err);
            setConnectionState('disconnected');
          },
        });
      } else {
        console.error('[gateway] no auth token available, closing connection');
        ws.close();
        setConnectionState('disconnected');
      }
    };

    ws.onmessage = (event) => {
      if (wsRef.current !== ws) return; // stale connection
      try {
        const msg = JSON.parse(event.data as string);

        // rpc response
        if ('id' in msg && msg.id != null) {
          const pending = pendingRpcRef.current.get(msg.id);
          if (pending) {
            pendingRpcRef.current.delete(msg.id);
            if (msg.error) {
              pending.reject(new Error(msg.error));
            } else {
              pending.resolve(msg.result);
            }
          }
          return;
        }

        // event
        if ('event' in msg) {
          if (typeof msg.seq === 'number' && msg.seq > lastSeqRef.current) {
            lastSeqRef.current = msg.seq;
          }
          handleEvent(msg as GatewayEvent);
        }
      } catch {}
    };

    ws.onclose = () => {
      if (wsRef.current !== ws) return; // stale connection
      setConnectionState('disconnected');
      wsRef.current = null;
      pendingRpcRef.current.forEach(p => p.reject(new Error('Connection closed')));
      pendingRpcRef.current.clear();
      // clear stale pending questions — server-side promises are dead
      setSessionStates(prev => {
        let changed = false;
        const next = { ...prev };
        for (const sk of Object.keys(next)) {
          if (next[sk].pendingQuestion) {
            next[sk] = { ...next[sk], pendingQuestion: null };
            changed = true;
          }
        }
        return changed ? next : prev;
      });
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = window.setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [url, rpc, handleEvent]);

  useEffect(() => {
    connect();
    return () => {
      if (pendingSubscribeRef.current) {
        clearTimeout(pendingSubscribeRef.current);
        pendingSubscribeRef.current = null;
      }
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (streamRafRef.current !== null) cancelAnimationFrame(streamRafRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);

  const sendMessage = useCallback(async (prompt: string, sessionKey?: string, chatId?: string) => {
    const sk = sessionKey || activeSessionKeyRef.current;
    const cid = chatId || sk.split(':').slice(2).join(':') || currentChatIdRef.current;
    activeSessionKeyRef.current = sk;
    currentChatIdRef.current = cid;
    setActiveSessionKey(sk);
    // Optimistic update: add user message and set status
    setSessionStates(prev => {
      const state = prev[sk] || { ...DEFAULT_SESSION_STATE };
      return {
        ...prev,
        [sk]: {
          ...state,
          chatItems: [...state.chatItems, { type: 'user', content: prompt, timestamp: Date.now() }],
          agentStatus: state.agentStatus === 'idle' ? 'thinking...' : state.agentStatus,
        },
      };
    });
    try {
      const res = await rpc('chat.send', { prompt, chatId: cid }) as { sessionKey?: string } | undefined;
      if (res?.sessionKey && res.sessionKey !== sk) {
        // sessionKey changed (e.g. server normalized it) — migrate state
        activeSessionKeyRef.current = res.sessionKey;
        setActiveSessionKey(res.sessionKey);
      }
    } catch (err) {
      setSessionStates(prev => {
        const state = prev[sk];
        if (!state) return prev;
        return {
          ...prev,
          [sk]: {
            ...state,
            chatItems: [...state.chatItems, { type: 'error', content: err instanceof Error ? err.message : String(err), timestamp: Date.now() }],
            agentStatus: 'idle',
          },
        };
      });
    }
  }, [rpc]);

  const loadSession = useCallback(async (sessionId: string, sessionKey?: string, chatId?: string) => {
    // Legacy single-session load — now delegates to loadSessionIntoMap + setActiveSession
    const cid = chatId || sessionId;
    const sk = sessionKey || `desktop:dm:${cid}`;
    trackedSessionsRef.current.add(sk);
    setSessionStates(prev => {
      if (prev[sk]) return prev;
      return { ...prev, [sk]: { ...DEFAULT_SESSION_STATE } };
    });
    activeSessionKeyRef.current = sk;
    currentChatIdRef.current = cid;
    setActiveSessionKey(sk);
    await loadSessionIntoMap(sessionId, sk, cid);
  }, [loadSessionIntoMap]);

  const answerQuestion = useCallback(async (requestId: string, answers: Record<string, string>, sessionKey?: string) => {
    try {
      await rpc('chat.answerQuestion', { requestId, answers });
      const sk = sessionKey || activeSessionKeyRef.current;
      setSessionStates(prev => {
        const state = prev[sk];
        if (!state) return prev;
        return { ...prev, [sk]: { ...state, pendingQuestion: null, agentStatus: 'thinking...' } };
      });
    } catch (err) {
      console.error('failed to answer question:', err);
      // question already timed out or gone server-side — clear UI anyway
      const sk = sessionKey || activeSessionKeyRef.current;
      setSessionStates(prev => {
        const state = prev[sk];
        if (!state) return prev;
        return { ...prev, [sk]: { ...state, pendingQuestion: null } };
      });
    }
  }, [rpc]);

  const dismissQuestion = useCallback((sessionKey?: string) => {
    const sk = sessionKey || activeSessionKeyRef.current;
    setSessionStates(prev => {
      const state = prev[sk];
      if (!state) return prev;
      return { ...prev, [sk]: { ...state, pendingQuestion: null } };
    });
  }, []);

  const approveToolUse = useCallback(async (requestId: string, modifiedInput?: Record<string, unknown>) => {
    try {
      await rpc('tool.approve', { requestId, modifiedInput });
      setPendingApprovals(prev => prev.filter(a => a.requestId !== requestId));
    } catch (err) {
      console.error('failed to approve:', err);
    }
  }, [rpc]);

  const denyToolUse = useCallback(async (requestId: string, reason?: string) => {
    try {
      await rpc('tool.deny', { requestId, reason });
      setPendingApprovals(prev => prev.filter(a => a.requestId !== requestId));
    } catch (err) {
      console.error('failed to deny:', err);
    }
  }, [rpc]);

  const abortAgent = useCallback(async (sessionKey?: string) => {
    try {
      await rpc('agent.abort', { sessionKey: sessionKey || activeSessionKeyRef.current });
    } catch (err) {
      console.error('failed to abort:', err);
    }
  }, [rpc]);

  const newSession = useCallback(() => {
    const newChatId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const sk = `desktop:dm:${newChatId}`;
    currentChatIdRef.current = newChatId;
    activeSessionKeyRef.current = sk;
    trackedSessionsRef.current.add(sk);
    setSessionStates(prev => ({ ...prev, [sk]: { ...DEFAULT_SESSION_STATE } }));
    setActiveSessionKey(sk);
    return { sessionKey: sk, chatId: newChatId };
  }, []);

  const changeModel = useCallback(async (newModel: string) => {
    await rpc('config.set', { key: 'model', value: newModel });
    setModel(newModel);
  }, [rpc]);

  const setConfig = useCallback(async (key: string, value: unknown) => {
    // optimistic local update
    setConfigData(prev => prev ? setNestedKey(prev, key, value) : prev);
    await rpc('config.set', { key, value });
  }, [rpc]);

  const refreshConfig = useCallback(async () => {
    const res = await rpc('config.get') as Record<string, unknown>;
    setConfigData(res);
    if (res.model) setModel(res.model as string);
  }, [rpc]);

  const getSecuritySenders = useCallback(async () => {
    return await rpc('security.senders.list') as { telegram: string[]; whatsapp: string[] };
  }, [rpc]);

  const addSender = useCallback(async (channel: string, senderId: string) => {
    await rpc('security.senders.add', { channel, senderId });
  }, [rpc]);

  const removeSender = useCallback(async (channel: string, senderId: string) => {
    await rpc('security.senders.remove', { channel, senderId });
  }, [rpc]);

  const setChannelPolicy = useCallback(async (key: string, value: string) => {
    await rpc('config.set', { key, value });
  }, [rpc]);

  const restartChannel = useCallback(async (channel: string) => {
    await rpc('channels.stop', { channel });
    await rpc('channels.start', { channel });
  }, [rpc]);

  const onFileChange = useCallback((listener: (path: string) => void) => {
    fsChangeListenersRef.current.add(listener);
    return () => {
      fsChangeListenersRef.current.delete(listener);
    };
  }, []);

  // tool policy RPCs
  const getToolPolicies = useCallback(async () => {
    return await rpc('security.tools.get') as {
      global: { allow?: string[]; deny?: string[] };
      whatsapp: { allow?: string[]; deny?: string[] };
      telegram: { allow?: string[]; deny?: string[] };
    };
  }, [rpc]);

  const setToolPolicy = useCallback(async (target: string, allow?: string[], deny?: string[]) => {
    await rpc('security.tools.set', { target, allow, deny });
  }, [rpc]);

  // path access RPCs
  const getPathPolicies = useCallback(async () => {
    return await rpc('security.paths.get') as {
      global: { allowed: string[]; denied: string[]; alwaysDenied: string[] };
      whatsapp: { allowed: string[]; denied: string[] };
      telegram: { allowed: string[]; denied: string[] };
    };
  }, [rpc]);

  const setPathPolicy = useCallback(async (target: string, allowed?: string[], denied?: string[]) => {
    await rpc('security.paths.set', { target, allowed, denied });
  }, [rpc]);

  const whatsappCheckStatus = useCallback(async () => {
    const res = await rpc('channels.whatsapp.status') as { linked: boolean };
    setWhatsappLoginStatus(res.linked ? 'connected' : 'not_linked');
    if (!res.linked) setWhatsappLoginError(null);
    return res;
  }, [rpc]);

  const whatsappLogin = useCallback(async () => {
    setWhatsappLoginStatus('connecting');
    setWhatsappQr(null);
    setWhatsappLoginError(null);
    return await rpc('channels.whatsapp.login', undefined, 10000) as { success: boolean; started?: boolean; inProgress?: boolean; selfJid?: string; error?: string };
  }, [rpc]);

  const whatsappLogout = useCallback(async () => {
    await rpc('channels.whatsapp.logout');
    setWhatsappLoginStatus('not_linked');
    setWhatsappQr(null);
    setWhatsappLoginError(null);
  }, [rpc]);

  const telegramCheckStatus = useCallback(async () => {
    const res = await rpc('channels.telegram.status') as { linked: boolean; botUsername: string | null };
    setTelegramLinkStatus(res.linked ? 'linked' : 'unlinked');
    setTelegramBotUsername(res.botUsername);
    if (!res.linked) setTelegramLinkError(null);
    return res;
  }, [rpc]);

  const telegramLink = useCallback(async (token: string) => {
    setTelegramLinkStatus('linking');
    setTelegramLinkError(null);
    try {
      const res = await rpc('channels.telegram.link', { token }, 15000) as {
        success: boolean;
        botId?: number;
        botUsername?: string;
        botName?: string;
      };
      if (res.success) {
        setTelegramLinkStatus('linked');
        setTelegramBotUsername(res.botUsername || null);
      }
      return res;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setTelegramLinkError(msg);
      setTelegramLinkStatus('unlinked');
      throw err;
    }
  }, [rpc]);

  const telegramUnlink = useCallback(async () => {
    await rpc('channels.telegram.unlink');
    setTelegramLinkStatus('unlinked');
    setTelegramBotUsername(null);
    setTelegramLinkError(null);
  }, [rpc]);

  // provider helpers
  const getProviderStatus = useCallback(async () => {
    const res = await rpc('provider.get') as { name: string; auth: { authenticated: boolean; method?: string; identity?: string; error?: string; model?: string; cliVersion?: string; permissionMode?: string } };
    setProviderInfo(res);
    return res;
  }, [rpc]);

  const setProvider = useCallback(async (name: string) => {
    await rpc('provider.set', { name });
    const res = await rpc('provider.get') as { name: string; auth: { authenticated: boolean; method?: string; identity?: string; error?: string; model?: string; cliVersion?: string; permissionMode?: string } };
    setProviderInfo(res);
    return res;
  }, [rpc]);

  const authWithApiKey = useCallback(async (provider: string, apiKey: string) => {
    const res = await rpc('provider.auth.apiKey', { provider, apiKey }) as { authenticated: boolean; method?: string; error?: string };
    if (res.authenticated) {
      setProviderInfo(prev => prev ? { ...prev, auth: res } : { name: provider, auth: res });
    }
    return res;
  }, [rpc]);

  const startOAuth = useCallback(async (provider: string) => {
    return await rpc('provider.auth.oauth', { provider }) as { authUrl: string; loginId: string };
  }, [rpc]);

  const completeOAuth = useCallback(async (provider: string, loginId: string) => {
    const res = await rpc('provider.auth.oauth.complete', { provider, loginId }) as { authenticated: boolean; method?: string; error?: string };
    if (res.authenticated) {
      setProviderInfo(prev => prev ? { ...prev, auth: res } : { name: provider, auth: res });
    }
    return res;
  }, [rpc]);

  const checkProvider = useCallback(async (provider: string) => {
    return await rpc('provider.check', { provider }) as { ready: boolean; reason?: string };
  }, [rpc]);

  const getProviderAuth = useCallback(async (provider: string) => {
    return await rpc('provider.auth.status', { provider }) as { authenticated: boolean; method?: string; identity?: string; error?: string };
  }, [rpc]);

  const detectProviders = useCallback(async () => {
    return await rpc('provider.detect') as {
      claude: { installed: boolean; hasOAuth: boolean; hasApiKey: boolean };
      codex: { installed: boolean; hasAuth: boolean };
    };
  }, [rpc]);

  const runBackground = useCallback(async (prompt: string) => {
    return await rpc('agent.run_background', { prompt }) as { backgroundRunId: string; sessionKey: string };
  }, [rpc]);

  const getBackgroundRuns = useCallback(async () => {
    const runs = await rpc('agent.background_runs') as BackgroundRun[];
    setBackgroundRuns(runs);
    return runs;
  }, [rpc]);

  // --- Derived values from active session (backward compat) ---

  const activeState = sessionStates[activeSessionKey] || DEFAULT_SESSION_STATE;

  const chatItems = activeState.chatItems;
  const agentStatus = activeState.agentStatus;
  const currentSessionId = activeState.sessionId;
  const pendingQuestion = activeState.pendingQuestion;

  // find the last TodoWrite / AskUserQuestion inputs (cheap scan, no parsing)
  const lastTodoInput = useMemo(() => {
    for (let i = chatItems.length - 1; i >= 0; i--) {
      const item = chatItems[i];
      if (item.type === 'tool_use' && item.name === 'TodoWrite')
        return { input: item.input, streaming: !!item.streaming };
    }
    return null;
  }, [chatItems]);

  const lastAskInput = useMemo(() => {
    for (let i = chatItems.length - 1; i >= 0; i--) {
      const item = chatItems[i];
      if (item.type === 'tool_use' && item.name === 'AskUserQuestion' && item.streaming)
        return item.input;
    }
    return null;
  }, [chatItems]);

  // only run jsonrepair when the relevant input actually changes
  const progress = useMemo<ProgressItem[]>(() => {
    if (!lastTodoInput) return [];
    try {
      const parsed = lastTodoInput.streaming
        ? JSON.parse(jsonrepair(lastTodoInput.input))
        : JSON.parse(lastTodoInput.input);
      return parsed.todos || [];
    } catch { return []; }
  }, [lastTodoInput]);

  const streamingQuestion = useMemo<AskUserQuestion['questions'] | null>(() => {
    if (!lastAskInput) return null;
    try {
      const parsed = JSON.parse(jsonrepair(lastAskInput));
      const qs = parsed.questions;
      if (!Array.isArray(qs) || qs.length === 0) return null;
      const valid = qs.filter((q: any) => q?.question && Array.isArray(q?.options));
      return valid.length > 0 ? valid : null;
    } catch { return null; }
  }, [lastAskInput]);

  return {
    connectionState,
    // Active session derived values (backward compat)
    chatItems,
    progress,
    agentStatus,
    currentSessionId,
    pendingQuestion,
    streamingQuestion,
    // Multi-session state
    sessionStates,
    activeSessionKey,
    trackSession,
    trackSessionDebounced,
    untrackSession,
    setActiveSession,
    loadSessionIntoMap,
    onSessionIdChangeRef,
    onNotifiableEventRef,
    // Global state
    channelMessages,
    channelStatuses,
    sessions,
    ws: wsRef.current,
    rpc,
    sendMessage,
    abortAgent,
    newSession,
    loadSession,
    setCurrentSessionId: useCallback((id: string | undefined) => {
      const sk = activeSessionKeyRef.current;
      setSessionStates(prev => {
        const state = prev[sk];
        if (!state) return prev;
        return { ...prev, [sk]: { ...state, sessionId: id } };
      });
    }, []),
    model,
    changeModel,
    configData,
    setConfig,
    refreshConfig,
    answerQuestion,
    dismissQuestion,
    pendingApprovals,
    notifications,
    approveToolUse,
    denyToolUse,
    onFileChange,
    getSecuritySenders,
    addSender,
    removeSender,
    setChannelPolicy,
    restartChannel,
    getToolPolicies,
    setToolPolicy,
    getPathPolicies,
    setPathPolicy,
    whatsappQr,
    whatsappLoginStatus,
    whatsappLoginError,
    whatsappCheckStatus,
    whatsappLogin,
    whatsappLogout,
    telegramLinkStatus,
    telegramBotUsername,
    telegramLinkError,
    telegramCheckStatus,
    telegramLink,
    telegramUnlink,
    providerInfo,
    goalsVersion,
    researchVersion,
    backgroundRuns,
    calendarRuns,
    markCalendarRunsSeen: useCallback(() => {
      setCalendarRuns(prev => prev.map(r => ({ ...r, seen: true })));
    }, []),
    runBackground,
    getBackgroundRuns,
    getProviderStatus,
    setProvider,
    authWithApiKey,
    startOAuth,
    completeOAuth,
    checkProvider,
    getProviderAuth,
    detectProviders,
  };
}
