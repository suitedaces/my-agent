import { useState, useRef, useEffect, type KeyboardEvent } from 'react';
import Markdown from 'react-markdown';
import type { useGateway, ChatItem, AskUserQuestion } from '../hooks/useGateway';

type Props = {
  gateway: ReturnType<typeof useGateway>;
};

const TOOL_TEXT: Record<string, { pending: string; done: string }> = {
  Read: { pending: 'Reading file', done: 'Read file' },
  Write: { pending: 'Writing file', done: 'Wrote file' },
  Edit: { pending: 'Editing file', done: 'Edited file' },
  Glob: { pending: 'Searching files', done: 'Searched files' },
  Grep: { pending: 'Searching code', done: 'Searched code' },
  Bash: { pending: 'Running command', done: 'Ran command' },
  WebFetch: { pending: 'Fetching URL', done: 'Fetched URL' },
  WebSearch: { pending: 'Searching web', done: 'Searched web' },
  Task: { pending: 'Running task', done: 'Completed task' },
  AskUserQuestion: { pending: 'Asking question', done: 'Got answer' },
  TodoWrite: { pending: 'Updating tasks', done: 'Updated tasks' },
  NotebookEdit: { pending: 'Editing notebook', done: 'Edited notebook' },
  message: { pending: 'Sending message', done: 'Sent message' },
  screenshot: { pending: 'Taking screenshot', done: 'Took screenshot' },
  schedule_reminder: { pending: 'Scheduling reminder', done: 'Scheduled reminder' },
  schedule_recurring: { pending: 'Scheduling recurring task', done: 'Scheduled recurring task' },
  schedule_cron: { pending: 'Scheduling cron job', done: 'Scheduled cron job' },
  list_reminders: { pending: 'Listing reminders', done: 'Listed reminders' },
  cancel_reminder: { pending: 'Cancelling reminder', done: 'Cancelled reminder' },
};

function toolText(name: string, state: 'pending' | 'done'): string {
  const t = TOOL_TEXT[name];
  return t ? t[state] : (state === 'pending' ? `Running ${name}` : `Ran ${name}`);
}

function ToolUseItem({ item }: { item: Extract<ChatItem, { type: 'tool_use' }> }) {
  const [open, setOpen] = useState(false);
  const hasOutput = item.output != null;
  const isPending = item.streaming || !hasOutput;
  const statusIcon = item.streaming ? '...' : hasOutput ? (item.is_error ? '✗' : '✓') : '…';
  const statusClass = item.is_error ? 'error' : hasOutput ? 'success' : '';
  const displayName = toolText(item.name, isPending ? 'pending' : 'done');

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
        <span className="tool-name">{displayName}</span>
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

function AskUserQuestionPanel({
  question,
  onAnswer,
  onDismiss,
}: {
  question: AskUserQuestion;
  onAnswer: (requestId: string, answers: Record<string, string>) => void;
  onDismiss: () => void;
}) {
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [otherTexts, setOtherTexts] = useState<Record<string, string>>({});
  const [useOther, setUseOther] = useState<Record<string, boolean>>({});

  const handleSelect = (questionText: string, label: string, multiSelect: boolean) => {
    if (multiSelect) {
      setSelections(prev => {
        const current = prev[questionText] || '';
        const labels = current ? current.split(', ') : [];
        const idx = labels.indexOf(label);
        if (idx >= 0) labels.splice(idx, 1);
        else labels.push(label);
        return { ...prev, [questionText]: labels.join(', ') };
      });
      setUseOther(prev => ({ ...prev, [questionText]: false }));
    } else {
      setSelections(prev => ({ ...prev, [questionText]: label }));
      setUseOther(prev => ({ ...prev, [questionText]: false }));
    }
  };

  const handleSubmit = () => {
    const answers: Record<string, string> = {};
    for (const q of question.questions) {
      if (useOther[q.question] && otherTexts[q.question]) {
        answers[q.question] = otherTexts[q.question];
      } else {
        answers[q.question] = selections[q.question] || '';
      }
    }
    onAnswer(question.requestId, answers);
  };

  const allAnswered = question.questions.every(q =>
    (useOther[q.question] && otherTexts[q.question]) || selections[q.question]
  );

  return (
    <div className="ask-user-panel">
      {question.questions.map((q, qi) => (
        <div key={qi} className="ask-user-question">
          <div className="ask-user-header">{q.header}</div>
          <div className="ask-user-text">{q.question}</div>
          <div className="ask-user-options">
            {q.options.map((opt, oi) => {
              const selected = q.multiSelect
                ? (selections[q.question] || '').split(', ').includes(opt.label)
                : selections[q.question] === opt.label && !useOther[q.question];
              return (
                <button
                  key={oi}
                  className={`ask-user-option ${selected ? 'selected' : ''}`}
                  onClick={() => handleSelect(q.question, opt.label, q.multiSelect)}
                >
                  <span className="ask-user-option-label">{opt.label}</span>
                  <span className="ask-user-option-desc">{opt.description}</span>
                </button>
              );
            })}
            <button
              className={`ask-user-option ${useOther[q.question] ? 'selected' : ''}`}
              onClick={() => {
                setUseOther(prev => ({ ...prev, [q.question]: true }));
                setSelections(prev => ({ ...prev, [q.question]: '' }));
              }}
            >
              <span className="ask-user-option-label">Other</span>
              <span className="ask-user-option-desc">type your own answer</span>
            </button>
          </div>
          {useOther[q.question] && (
            <input
              className="ask-user-other-input"
              placeholder="type your answer..."
              value={otherTexts[q.question] || ''}
              onChange={e => setOtherTexts(prev => ({ ...prev, [q.question]: e.target.value }))}
              autoFocus
            />
          )}
        </div>
      ))}
      <div className="ask-user-actions">
        <button className="btn" onClick={onDismiss}>skip</button>
        <button className="btn btn-primary" onClick={handleSubmit} disabled={!allAnswered}>
          answer
        </button>
      </div>
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

      {gateway.pendingQuestion && (
        <AskUserQuestionPanel
          question={gateway.pendingQuestion}
          onAnswer={gateway.answerQuestion}
          onDismiss={gateway.dismissQuestion}
        />
      )}

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
