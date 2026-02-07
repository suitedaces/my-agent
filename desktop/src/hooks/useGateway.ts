import { useState, useEffect, useRef, useCallback } from 'react';

export type ConnectionState = 'connecting' | 'connected' | 'disconnected';

export type ChatItem =
  | { type: 'user'; content: string; timestamp: number }
  | { type: 'text'; content: string; streaming?: boolean; timestamp: number }
  | { type: 'tool_use'; id: string; name: string; input: string; output?: string; is_error?: boolean; streaming?: boolean; timestamp: number }
  | { type: 'thinking'; content: string; streaming?: boolean; timestamp: number }
  | { type: 'result'; cost?: number; timestamp: number }
  | { type: 'error'; content: string; timestamp: number };

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
              name: block.name || 'unknown',
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

const SESSION_STORAGE_KEY = 'my-agent:sessionId';

export function useGateway(url = 'ws://localhost:18789') {
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [chatItems, setChatItems] = useState<ChatItem[]>([]);
  const [channelMessages, setChannelMessages] = useState<ChannelMessage[]>([]);
  const [channelStatuses, setChannelStatuses] = useState<ChannelStatusInfo[]>([]);
  const [agentStatus, setAgentStatus] = useState<string>('idle');
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | undefined>();
  const [pendingQuestion, setPendingQuestion] = useState<AskUserQuestion | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const rpcIdRef = useRef(0);
  const pendingRpcRef = useRef(new Map<number, PendingRpc>());
  const reconnectTimerRef = useRef<number | null>(null);
  const fsChangeListenersRef = useRef<Set<(path: string) => void>>(new Set());
  // track which session key we're viewing - only show stream events for this key
  const activeSessionKeyRef = useRef<string>('desktop:dm:default');

  const rpc = useCallback(async (method: string, params?: Record<string, unknown>): Promise<unknown> => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected to gateway');
    }

    const id = ++rpcIdRef.current;
    return new Promise((resolve, reject) => {
      pendingRpcRef.current.set(id, { resolve, reject });
      ws.send(JSON.stringify({ method, params, id }));

      // timeout after 30s
      setTimeout(() => {
        if (pendingRpcRef.current.has(id)) {
          pendingRpcRef.current.delete(id);
          reject(new Error(`RPC timeout: ${method}`));
        }
      }, 30000);
    });
  }, []);

  const handleEvent = useCallback((event: GatewayEvent) => {
    const { event: name, data } = event;

    switch (name) {
      case 'agent.user_message': {
        const d = data as { source: string; sessionKey?: string; prompt: string; timestamp: number };
        if (d.sessionKey && d.sessionKey !== activeSessionKeyRef.current) break;
        // desktop/chat already adds user item in sendMessage, skip to avoid dupes
        if (d.source !== 'desktop/chat') {
          setChatItems(prev => [...prev, {
            type: 'user',
            content: d.prompt,
            timestamp: d.timestamp || Date.now(),
          }]);
          setAgentStatus('thinking...');
        }
        break;
      }

      case 'agent.tool_use': {
        const d = data as { source: string; sessionKey?: string; tool: string; timestamp: number };
        if (d.sessionKey && d.sessionKey !== activeSessionKeyRef.current) break;
        setAgentStatus(`running ${d.tool}...`);
        break;
      }

      case 'agent.stream': {
        const d = data as { source: string; sessionKey?: string; event: Record<string, unknown>; timestamp: number };
        if (d.sessionKey && d.sessionKey !== activeSessionKeyRef.current) break;
        const evt = d.event;
        if (!evt) break;

        if (evt.type === 'content_block_start') {
          const cb = evt.content_block as Record<string, unknown>;
          if (!cb) break;
          if (cb.type === 'text') {
            setChatItems(prev => [...prev, { type: 'text', content: '', streaming: true, timestamp: Date.now() }]);
          } else if (cb.type === 'tool_use') {
            setChatItems(prev => [...prev, { type: 'tool_use', id: (cb.id as string) || '', name: (cb.name as string) || 'unknown', input: '', streaming: true, timestamp: Date.now() }]);
          } else if (cb.type === 'thinking') {
            setChatItems(prev => [...prev, { type: 'thinking', content: '', streaming: true, timestamp: Date.now() }]);
          }
        } else if (evt.type === 'content_block_delta') {
          const delta = evt.delta as Record<string, unknown>;
          if (!delta) break;
          if (delta.type === 'text_delta' && typeof delta.text === 'string') {
            const text = delta.text;
            setChatItems(prev => {
              // find last streaming text item
              for (let i = prev.length - 1; i >= 0; i--) {
                const it = prev[i];
                if (it.type === 'text' && it.streaming) {
                  const updated = [...prev];
                  updated[i] = { ...it, content: it.content + text };
                  return updated;
                }
              }
              return prev;
            });
          } else if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
            const json = delta.partial_json;
            setChatItems(prev => {
              for (let i = prev.length - 1; i >= 0; i--) {
                const it = prev[i];
                if (it.type === 'tool_use' && it.streaming) {
                  const updated = [...prev];
                  updated[i] = { ...it, input: it.input + json };
                  return updated;
                }
              }
              return prev;
            });
          } else if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string') {
            const thinking = delta.thinking;
            setChatItems(prev => {
              for (let i = prev.length - 1; i >= 0; i--) {
                const it = prev[i];
                if (it.type === 'thinking' && it.streaming) {
                  const updated = [...prev];
                  updated[i] = { ...it, content: it.content + thinking };
                  return updated;
                }
              }
              return prev;
            });
          }
        } else if (evt.type === 'content_block_stop') {
          setChatItems(prev => {
            // find last streaming item and mark done
            for (let i = prev.length - 1; i >= 0; i--) {
              const it = prev[i];
              if ('streaming' in it && it.streaming) {
                const updated = [...prev];
                updated[i] = { ...it, streaming: false };
                return updated;
              }
            }
            return prev;
          });
        }
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
          const updated = prev.map(item =>
            'streaming' in item && item.streaming ? { ...item, streaming: false } : item
          );
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

      case 'agent.tool_result': {
        const d = data as { sessionKey?: string; tool_use_id: string; content: string; is_error?: boolean };
        if (d.sessionKey && d.sessionKey !== activeSessionKeyRef.current) break;
        setChatItems(prev => {
          let idx = -1;
          for (let i = prev.length - 1; i >= 0; i--) {
            const it = prev[i];
            if (it.type === 'tool_use' && it.id === d.tool_use_id) { idx = i; break; }
          }
          if (idx >= 0) {
            const updated = [...prev];
            const item = updated[idx] as Extract<ChatItem, { type: 'tool_use' }>;
            updated[idx] = { ...item, output: d.content, is_error: d.is_error };
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
        const d = data as { activeRun?: boolean; source?: string };
        setAgentStatus(d.activeRun ? `running (${d.source || 'agent'})` : 'idle');
        break;
      }

      case 'fs.change': {
        const d = data as { path: string; eventType: string; filename: string | null };
        // notify all listeners
        fsChangeListenersRef.current.forEach(listener => listener(d.path));
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
      if (wsRef.current !== ws) return; // stale connection
      setConnectionState('connected');
      rpc('status').then((res) => {
        const s = res as { channels?: ChannelStatusInfo[] };
        if (s.channels) setChannelStatuses(s.channels);
      }).catch(() => {});
      rpc('sessions.list').then((res) => {
        const arr = res as SessionInfo[];
        if (Array.isArray(arr)) setSessions(arr);
      }).catch(() => {});
      // restore last session from localStorage
      const savedSession = localStorage.getItem(SESSION_STORAGE_KEY);
      if (savedSession) {
        rpc('sessions.get', { sessionId: savedSession }).then((res) => {
          const r = res as { sessionId: string; messages: SessionMessage[] };
          if (r?.messages) {
            setChatItems(sessionMessagesToChatItems(r.messages));
            setCurrentSessionId(savedSession);
          }
        }).catch(() => {
          localStorage.removeItem(SESSION_STORAGE_KEY);
        });
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
    setAgentStatus('thinking...');
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
        // set active session key for stream filtering
        activeSessionKeyRef.current = sessionKey || 'desktop:dm:default';
        localStorage.setItem(SESSION_STORAGE_KEY, sessionId);
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

  const newSession = useCallback(() => {
    setCurrentSessionId(undefined);
    setChatItems([]);
    activeSessionKeyRef.current = 'desktop:dm:default';
    localStorage.removeItem(SESSION_STORAGE_KEY);
  }, []);

  const onFileChange = useCallback((listener: (path: string) => void) => {
    fsChangeListenersRef.current.add(listener);
    return () => {
      fsChangeListenersRef.current.delete(listener);
    };
  }, []);

  return {
    connectionState,
    chatItems,
    channelMessages,
    channelStatuses,
    agentStatus,
    sessions,
    currentSessionId,
    pendingQuestion,
    ws: wsRef.current,
    rpc,
    sendMessage,
    newSession,
    loadSession,
    setCurrentSessionId,
    answerQuestion,
    dismissQuestion,
    onFileChange,
  };
}
