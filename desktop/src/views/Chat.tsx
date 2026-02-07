import { useState, useRef, useEffect, type KeyboardEvent } from 'react';
import Markdown from 'react-markdown';
import type { useGateway, ChatItem } from '../hooks/useGateway';

type Props = {
  gateway: ReturnType<typeof useGateway>;
};

function ToolUseItem({ item }: { item: Extract<ChatItem, { type: 'tool_use' }> }) {
  const [open, setOpen] = useState(false);
  const hasOutput = item.output != null;
  const statusIcon = item.streaming ? '...' : hasOutput ? (item.is_error ? '✗' : '✓') : '…';
  const statusClass = item.is_error ? 'error' : hasOutput ? 'success' : '';

  let inputSummary = '';
  try {
    const parsed = JSON.parse(item.input);
    // pick the most meaningful field per tool
    const s = parsed.command       // Bash
      || parsed.file_path          // Read, Write, Edit
      || parsed.notebook_path      // NotebookEdit
      || parsed.pattern            // Glob, Grep
      || parsed.url                // WebFetch
      || parsed.query              // WebSearch
      || parsed.description        // Task
      || parsed.prompt             // Task, WebFetch
      || parsed.content            // Write (body)
      || parsed.old_string         // Edit
      || parsed.skill              // Skill
      || parsed.shell_id           // BashOutput, KillBash
      || parsed.server             // ReadMcpResource
      || parsed.uri                // ReadMcpResource
      || parsed.plan;              // ExitPlanMode
    if (typeof s === 'string') inputSummary = s.slice(0, 120);
    else {
      // fallback: first string value from any field
      const first = Object.values(parsed).find(v => typeof v === 'string') as string | undefined;
      inputSummary = (first || JSON.stringify(parsed)).slice(0, 120);
    }
  } catch {
    inputSummary = item.input.slice(0, 120);
  }

  return (
    <div className="chat-item chat-item-tool">
      <div className="tool-header" onClick={() => setOpen(o => !o)}>
        <span className={`tool-status ${statusClass}`}>{statusIcon}</span>
        <span className="tool-name">{item.name}</span>
        <span className="tool-summary">{inputSummary}</span>
        <span className="tool-chevron">{open ? '▾' : '▸'}</span>
      </div>
      {open && (
        <div className="tool-detail">
          <div className="tool-detail-section">
            <div className="tool-detail-label">input</div>
            <pre className="tool-detail-content">{item.input}</pre>
          </div>
          {hasOutput && (
            <div className="tool-detail-section">
              <div className="tool-detail-label">output</div>
              <pre className={`tool-detail-content ${item.is_error ? 'tool-error' : ''}`}>{item.output}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ChatView({ gateway }: Props) {
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [gateway.chatItems]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSend = async () => {
    const prompt = input.trim();
    if (!prompt || sending) return;

    setInput('');
    setSending(true);
    try {
      await gateway.sendMessage(prompt);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const formatTime = (ts: number) => {
    return new Date(ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
  };

  const renderItem = (item: ChatItem, i: number) => {
    switch (item.type) {
      case 'user':
        return (
          <div key={i} className="chat-item chat-item-user">
            <span className="chat-item-label">{'>'}</span>
            <span className="chat-item-content">{item.content}</span>
          </div>
        );
      case 'text':
        return (
          <div key={i} className="chat-item chat-item-text">
            <Markdown>{item.content}</Markdown>
            {item.streaming && <span className="streaming-cursor" />}
          </div>
        );
      case 'tool_use':
        return <ToolUseItem key={i} item={item} />;
      case 'thinking':
        return (
          <div key={i} className="chat-item chat-item-thinking">
            {item.content}
            {item.streaming && <span className="streaming-cursor" />}
          </div>
        );
      case 'result':
        return (
          <div key={i} className="chat-item chat-item-result">
            {item.cost != null && <span>${item.cost.toFixed(4)}</span>}
            <span>{formatTime(item.timestamp)}</span>
          </div>
        );
      case 'error':
        return (
          <div key={i} className="chat-item chat-item-error">
            {item.content}
          </div>
        );
    }
  };

  return (
    <div className="chat-view">
      <div className="chat-header">
        <span style={{ fontWeight: 600, fontSize: 14 }}>Chat</span>
        <span style={{ color: 'var(--text-muted)', fontSize: 11, marginLeft: 8 }}>
          {gateway.currentSessionId ? `session: ${gateway.currentSessionId.slice(0, 8)}` : 'new session'}
        </span>
        <button
          className="btn"
          style={{ marginLeft: 'auto', fontSize: 11 }}
          onClick={gateway.newSession}
        >
          + new
        </button>
      </div>

      <div className="chat-messages">
        {gateway.chatItems.length === 0 && (
          <div className="empty-state">
            <div className="empty-state-icon">_</div>
            <div>send a message to start</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
              {gateway.connectionState === 'connected' ? 'connected to gateway' : 'waiting for gateway...'}
            </div>
          </div>
        )}

        {gateway.chatItems.map((item, i) => renderItem(item, i))}
        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-area">
        <div className="chat-input-wrapper">
          <textarea
            ref={inputRef}
            className="chat-input"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={gateway.connectionState === 'connected' ? 'type a message...' : 'waiting for gateway...'}
            disabled={gateway.connectionState !== 'connected'}
            rows={1}
          />
          <button
            className="chat-send-btn"
            onClick={handleSend}
            disabled={!input.trim() || sending || gateway.connectionState !== 'connected'}
          >
            send
          </button>
        </div>
      </div>
    </div>
  );
}
