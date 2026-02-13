import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

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
  screenshot: 'taking screenshot', browser: 'using browser', schedule_reminder: 'scheduling reminder',
  schedule_recurring: 'scheduling task', schedule_cron: 'scheduling cron job',
  list_reminders: 'listing reminders', cancel_reminder: 'cancelling reminder',
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
  timestamp: number;
};

export type ToolNotification = {
  toolName: string;
  input: Record<string, unknown>;
  tier: string;
  timestamp: number;
};

export type BackgroundRun = {
  id: string;
  sessionKey: string;
  prompt: string;
  startedAt: number;
  status: 'running' | 'completed' | 'error';
  result?: string;
  error?: string;
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

  for (const msg of messages) {
    const c = msg.content;
    const ts = new Date(msg.timestamp).getTime();

    if (msg.type === 'system') continue;

    if (msg.type === 'user') {
      const userMsg = (c as any).message;
      const blocks = userMsg?.content;
      // detect tool result messages by checking for tool_result blocks or tool_use_result field
      const hasToolResult = Array.isArray(blocks) && blocks.some((b: any) => b.type === 'tool_result');

      if (hasToolResult) {
        // tool results - patch matching tool_use items
        if (Array.isArray(blocks)) {
          for (const block of blocks) {
            if (block.type === 'tool_result') {
              let resultText = '';
              if (typeof block.content === 'string') {
                resultText = block.content;
              } else if (Array.isArray(block.content)) {
                resultText = block.content
                  .filter((b: any) => b.type === 'text')
                  .map((b: any) => b.text)
                  .join('\n');
              }
              for (let i = items.length - 1; i >= 0; i--) {
                const it = items[i];
                if (it.type === 'tool_use' && it.id === block.tool_use_id) {
                  items[i] = { ...it, output: resultText.slice(0, 2000), is_error: block.is_error || false };
                  break;
                }
              }
            }
          }
        }
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
      if (Array.isArray(blocks)) {
        for (const block of blocks) {
          if (block.type === 'text' && block.text) {
            items.push({ type: 'text', content: block.text, timestamp: ts });
          } else if (block.type === 'tool_use') {
            items.push({
              type: 'tool_use',
              id: block.id || '',
              name: cleanToolName(block.name || 'unknown'),
              input: typeof block.input === 'string' ? block.input : JSON.stringify(block.input || {}),
              timestamp: ts,
            });
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

const SESSION_STORAGE_KEY = 'dorabot:sessionId';

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

export function useGateway(url = 'wss://localhost:18789') {
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [chatItems, setChatItems] = useState<ChatItem[]>([]);
  const [channelMessages, setChannelMessages] = useState<ChannelMessage[]>([]);
  const [channelStatuses, setChannelStatuses] = useState<ChannelStatusInfo[]>([]);
  const [agentStatus, setAgentStatus] = useState<string>('idle');
  const [model, setModel] = useState<string>('');
  const [configData, setConfigData] = useState<Record<string, unknown> | null>(null);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | undefined>();
  const [pendingQuestion, setPendingQuestion] = useState<AskUserQuestion | null>(null);
  const [pendingApprovals, setPendingApprovals] = useState<ToolApproval[]>([]);
  const [notifications, setNotifications] = useState<ToolNotification[]>([]);
  const [whatsappQr, setWhatsappQr] = useState<string | null>(null);
  const [whatsappLoginStatus, setWhatsappLoginStatus] = useState<string>('unknown');
  const [whatsappLoginError, setWhatsappLoginError] = useState<string | null>(null);
  const [telegramLinkStatus, setTelegramLinkStatus] = useState<string>('unknown');
  const [telegramBotUsername, setTelegramBotUsername] = useState<string | null>(null);
  const [telegramLinkError, setTelegramLinkError] = useState<string | null>(null);
  const [providerInfo, setProviderInfo] = useState<{ name: string; auth: { authenticated: boolean; method?: string; identity?: string; error?: string; model?: string; cliVersion?: string; permissionMode?: string } } | null>(null);
  const [boardVersion, setBoardVersion] = useState(0);
  const [backgroundRuns, setBackgroundRuns] = useState<BackgroundRun[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const rpcIdRef = useRef(0);
  const pendingRpcRef = useRef(new Map<number, PendingRpc>());
  const reconnectTimerRef = useRef<number | null>(null);
  const fsChangeListenersRef = useRef<Set<(path: string) => void>>(new Set());
  // track which session key we're viewing - only show stream events for this key
  const activeSessionKeyRef = useRef<string>('desktop:dm:default');

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

  const handleEvent = useCallback((event: GatewayEvent) => {
    const { event: name, data } = event;

    switch (name) {
      case 'agent.user_message': {
        const d = data as { source: string; sessionKey?: string; prompt: string; injected?: boolean; timestamp: number };
        if (d.sessionKey && d.sessionKey !== activeSessionKeyRef.current) break;
        // desktop/chat already adds user item in sendMessage, skip to avoid dupes
        if (d.source !== 'desktop/chat') {
          setChatItems(prev => [...prev, {
            type: 'user',
            content: d.prompt,
            timestamp: d.timestamp || Date.now(),
          }]);
          setAgentStatus(prev => prev === 'idle' ? 'thinking...' : prev);
        }
        break;
      }

      case 'agent.tool_use': {
        const d = data as { source: string; sessionKey?: string; tool: string; timestamp: number };
        if (d.sessionKey && d.sessionKey !== activeSessionKeyRef.current) break;
        setAgentStatus(`${TOOL_PENDING_TEXT[d.tool] || `running ${d.tool}`}...`);
        break;
      }

      case 'agent.stream': {
        const d = data as { source: string; sessionKey?: string; event: Record<string, unknown>; parentToolUseId?: string | null; timestamp: number };
        if (d.sessionKey && d.sessionKey !== activeSessionKeyRef.current) break;
        const evt = d.event;
        if (!evt) break;
        const parentId = d.parentToolUseId;

        if (parentId) {
          // subagent event — route into parent tool_use's subItems
          setChatItems(prev => {
            for (let i = prev.length - 1; i >= 0; i--) {
              const it = prev[i];
              if (it.type === 'tool_use' && it.id === parentId) {
                const updated = [...prev];
                updated[i] = { ...it, subItems: applyStreamEvent(it.subItems || [], evt) };
                return updated;
              }
            }
            return prev;
          });
          break;
        }

        // top-level event
        setChatItems(prev => applyStreamEvent(prev, evt));
        break;
      }

      case 'agent.result': {
        const d = data as { sessionKey?: string; sessionId: string; result: string; usage?: { totalCostUsd?: number } };
        if (d.sessionKey && d.sessionKey !== activeSessionKeyRef.current) {
          // not our session, just refresh sessions list
          rpc('sessions.list').then((res) => {
            const arr = res as SessionInfo[];
            if (Array.isArray(arr)) setSessions(arr);
          }).catch(() => {});
          break;
        }
        setChatItems(prev => {
          const updated = prev.map(item => {
            let it = item;
            if ('streaming' in it && it.streaming) it = { ...it, streaming: false };
            // also clean up subItems for Task tools
            if (it.type === 'tool_use' && it.subItems?.length) {
              const subs = it.subItems.map(s =>
                'streaming' in s && s.streaming ? { ...s, streaming: false } : s
              );
              it = { ...it, subItems: subs };
            }
            return it;
          });
          updated.push({ type: 'result', cost: d.usage?.totalCostUsd, timestamp: Date.now() });
          return updated;
        });
        setAgentStatus('idle');
        if (d.sessionId) {
          setCurrentSessionId(d.sessionId);
          localStorage.setItem(SESSION_STORAGE_KEY, d.sessionId);
        }
        break;
      }

      case 'agent.error': {
        const d = data as { sessionKey?: string; error: string };
        if (d.sessionKey && d.sessionKey !== activeSessionKeyRef.current) break;
        setChatItems(prev => [...prev, {
          type: 'error',
          content: d.error,
          timestamp: Date.now(),
        }]);
        setAgentStatus('idle');
        break;
      }

      case 'agent.ask_user': {
        const d = data as { requestId: string; questions: AskUserQuestion['questions']; timestamp: number };
        setPendingQuestion({ requestId: d.requestId, questions: d.questions });
        setAgentStatus('waiting for input...');
        break;
      }

      case 'agent.message': {
        // Non-streaming assistant messages (Codex provider sends full messages, not stream deltas)
        const d = data as { source: string; sessionKey?: string; message: Record<string, unknown>; timestamp: number };
        if (d.sessionKey && d.sessionKey !== activeSessionKeyRef.current) break;
        const assistantMsg = d.message?.message as Record<string, unknown>;
        const content = assistantMsg?.content as unknown[];
        if (Array.isArray(content)) {
          for (const block of content) {
            const b = block as Record<string, unknown>;
            if (b.type === 'text' && typeof b.text === 'string') {
              setChatItems(prev => [...prev, { type: 'text', content: b.text as string, streaming: false, timestamp: d.timestamp || Date.now() }]);
            } else if (b.type === 'tool_use') {
              // streaming: true so tool cards show animations while waiting for result
              // (Codex sends full tool_use blocks, but result comes later)
              setChatItems(prev => [...prev, {
                type: 'tool_use',
                id: (b.id as string) || '',
                name: cleanToolName((b.name as string) || 'unknown'),
                input: typeof b.input === 'string' ? b.input : JSON.stringify(b.input || {}),
                streaming: true,
                timestamp: d.timestamp || Date.now(),
              }]);
            } else if (b.type === 'thinking' && typeof b.thinking === 'string') {
              setChatItems(prev => [...prev, { type: 'thinking', content: b.thinking as string, streaming: false, timestamp: d.timestamp || Date.now() }]);
            }
          }
        }
        break;
      }

      case 'agent.tool_result': {
        const d = data as { sessionKey?: string; tool_use_id: string; content: string; imageData?: string; is_error?: boolean; parentToolUseId?: string | null };
        if (d.sessionKey && d.sessionKey !== activeSessionKeyRef.current) break;
        setChatItems(prev => {
          // check subItems first if this result belongs to a subagent
          if (d.parentToolUseId) {
            for (let i = prev.length - 1; i >= 0; i--) {
              const it = prev[i];
              if (it.type === 'tool_use' && it.id === d.parentToolUseId && it.subItems) {
                for (let j = it.subItems.length - 1; j >= 0; j--) {
                  const sub = it.subItems[j];
                  if (sub.type === 'tool_use' && sub.id === d.tool_use_id) {
                    const updated = [...prev];
                    const newSubs = [...it.subItems];
                    newSubs[j] = { ...sub, output: d.content, imageData: d.imageData, is_error: d.is_error, streaming: false };
                    updated[i] = { ...it, subItems: newSubs };
                    return updated;
                  }
                }
              }
            }
          }
          // top-level tool result
          let idx = -1;
          for (let i = prev.length - 1; i >= 0; i--) {
            const it = prev[i];
            if (it.type === 'tool_use' && it.id === d.tool_use_id) { idx = i; break; }
          }
          if (idx >= 0) {
            const updated = [...prev];
            const item = updated[idx] as Extract<ChatItem, { type: 'tool_use' }>;
            updated[idx] = { ...item, output: d.content, imageData: d.imageData, is_error: d.is_error, streaming: false };
            return updated;
          }
          return prev;
        });
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
        const d = data as { activeRun?: boolean; source?: string; model?: string };
        if (d.model) setModel(d.model);
        setAgentStatus(d.activeRun ? `running (${d.source || 'agent'})` : 'idle');
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

      case 'board.update': {
        setBoardVersion(v => v + 1);
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
        // notify all listeners
        fsChangeListenersRef.current.forEach(listener => listener(d.path));
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
          break;
        }
        if (d.status === 'connecting' || d.status === 'qr_ready' || d.status === 'connected' || d.status === 'disconnected' || d.status === 'not_linked') {
          setWhatsappLoginError(null);
        }
        if (d.status === 'connected' || d.status === 'failed' || d.status === 'disconnected') {
          setWhatsappQr(null);
        }
        break;
      }

      case 'telegram.link_status': {
        const d = data as { status: string; botUsername?: string };
        if (d.status === 'linked') {
          setTelegramLinkStatus('linked');
          setTelegramBotUsername(d.botUsername || null);
          setTelegramLinkError(null);
        } else if (d.status === 'unlinked') {
          setTelegramLinkStatus('unlinked');
          setTelegramBotUsername(null);
          setTelegramLinkError(null);
        }
        break;
      }

      case 'provider.auth_complete': {
        const d = data as { provider: string; status: { authenticated: boolean; method?: string; identity?: string; error?: string; model?: string; cliVersion?: string; permissionMode?: string } };
        setProviderInfo(prev => prev ? { ...prev, auth: d.status } : { name: d.provider, auth: d.status });
        break;
      }
    }
  }, []);

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
        ws.send(JSON.stringify({ method: 'auth', params: { token }, id: authId }));
        pendingRpcRef.current.set(authId, {
          resolve: () => {
            setConnectionState('connected');
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
            const savedSession = localStorage.getItem(SESSION_STORAGE_KEY);
            if (savedSession) {
              rpc('sessions.get', { sessionId: savedSession }).then((res) => {
                const r = res as { sessionId: string; messages: SessionMessage[] };
                if (r?.messages) {
                  setChatItems(sessionMessagesToChatItems(r.messages));
                  setCurrentSessionId(savedSession);
                  // restore registry so conversation continues after reconnect
                  rpc('sessions.resume', { sessionId: savedSession }).catch(() => {});
                }
              }).catch(() => {
                localStorage.removeItem(SESSION_STORAGE_KEY);
              });
            }
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
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);

  const sendMessage = useCallback(async (prompt: string) => {
    setChatItems(prev => [...prev, {
      type: 'user',
      content: prompt,
      timestamp: Date.now(),
    }]);
    // don't override status if already running (injection case)
    setAgentStatus(prev => prev === 'idle' ? 'thinking...' : prev);
    try {
      await rpc('chat.send', { prompt });
    } catch (err) {
      setChatItems(prev => [...prev, {
        type: 'error',
        content: err instanceof Error ? err.message : String(err),
        timestamp: Date.now(),
      }]);
      setAgentStatus('idle');
    }
  }, [rpc]);

  const loadSession = useCallback(async (sessionId: string, sessionKey?: string) => {
    try {
      const res = await rpc('sessions.get', { sessionId }) as { sessionId: string; messages: SessionMessage[] };
      if (res?.messages) {
        const items = sessionMessagesToChatItems(res.messages);
        setChatItems(items);
        setCurrentSessionId(sessionId);
        activeSessionKeyRef.current = sessionKey || 'desktop:dm:default';
        localStorage.setItem(SESSION_STORAGE_KEY, sessionId);
        // restore registry entry so next chat.send continues this conversation
        rpc('sessions.resume', { sessionId }).catch((err: unknown) => {
          console.warn('failed to resume session in registry:', err);
        });
      }
    } catch (err) {
      console.error('failed to load session:', err);
    }
  }, [rpc]);

  const answerQuestion = useCallback(async (requestId: string, answers: Record<string, string>) => {
    try {
      await rpc('chat.answerQuestion', { requestId, answers });
      setPendingQuestion(null);
      setAgentStatus('thinking...');
    } catch (err) {
      console.error('failed to answer question:', err);
    }
  }, [rpc]);

  const dismissQuestion = useCallback(() => {
    setPendingQuestion(null);
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

  const abortAgent = useCallback(async () => {
    try {
      await rpc('agent.abort', {});
    } catch (err) {
      console.error('failed to abort:', err);
    }
  }, [rpc]);

  const newSession = useCallback(() => {
    setCurrentSessionId(undefined);
    setChatItems([]);
    activeSessionKeyRef.current = 'desktop:dm:default';
    localStorage.removeItem(SESSION_STORAGE_KEY);
    // reset session in gateway so next chat.send starts fresh
    rpc('sessions.reset', { channel: 'desktop', chatId: 'default' }).catch(() => {});
  }, [rpc]);

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

  const progress = useMemo<ProgressItem[]>(() => {
    for (let i = chatItems.length - 1; i >= 0; i--) {
      const item = chatItems[i];
      if (item.type === 'tool_use' && item.name === 'TodoWrite' && !item.streaming) {
        try { return JSON.parse(item.input).todos || []; } catch { return []; }
      }
    }
    return [];
  }, [chatItems]);

  return {
    connectionState,
    chatItems,
    progress,
    channelMessages,
    channelStatuses,
    agentStatus,
    sessions,
    currentSessionId,
    pendingQuestion,
    ws: wsRef.current,
    rpc,
    sendMessage,
    abortAgent,
    newSession,
    loadSession,
    setCurrentSessionId,
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
    boardVersion,
    backgroundRuns,
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
