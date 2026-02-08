import { useState, useRef, useEffect, type KeyboardEvent } from 'react';
import Markdown from 'react-markdown';
import type { useGateway, ChatItem, AskUserQuestion } from '../hooks/useGateway';
import { ApprovalUI } from '@/components/approval-ui';
import { ToolUI } from '@/components/tool-ui';
import { AuroraBackground } from '@/components/aceternity/aurora-background';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { Send, Square, Plus, ChevronDown, ChevronRight, Check, X } from 'lucide-react';

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
  schedule_recurring: { pending: 'Scheduling recurring', done: 'Scheduled recurring' },
  schedule_cron: { pending: 'Scheduling cron', done: 'Scheduled cron' },
  list_reminders: { pending: 'Listing reminders', done: 'Listed reminders' },
  cancel_reminder: { pending: 'Cancelling reminder', done: 'Cancelled reminder' },
  browser: { pending: 'Using browser', done: 'Used browser' },
};

function toolText(name: string, state: 'pending' | 'done'): string {
  const t = TOOL_TEXT[name];
  return t ? t[state] : (state === 'pending' ? `Running ${name}` : `Ran ${name}`);
}

function ToolUseItem({ item }: { item: Extract<ChatItem, { type: 'tool_use' }> }) {
  const [open, setOpen] = useState(false);
  const hasOutput = item.output != null;
  const isPending = item.streaming || !hasOutput;
  const displayName = toolText(item.name, isPending ? 'pending' : 'done');

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className="my-1 overflow-hidden border-border/50">
        <CollapsibleTrigger className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-secondary/50 transition-colors">
          {item.streaming ? (
            <div className="w-3 h-3 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          ) : hasOutput ? (
            item.is_error
              ? <X className="w-3 h-3 text-destructive" />
              : <Check className="w-3 h-3 text-success" />
          ) : (
            <div className="w-3 h-3 rounded-full border border-muted-foreground" />
          )}
          <span className="text-warning font-semibold">{displayName}</span>
          <span className="text-muted-foreground flex-1 truncate text-left">
            {(() => {
              try {
                const p = JSON.parse(item.input);
                return p.command || p.file_path || p.pattern || p.url || p.query || p.description || '';
              } catch { return item.input.slice(0, 80); }
            })()}
          </span>
          {open ? <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" /> : <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border-t border-border/50 px-3 py-2 bg-background">
            <ToolUI
              name={item.name}
              input={item.input}
              output={item.output}
              isError={item.is_error}
              streaming={item.streaming}
            />
          </div>
        </CollapsibleContent>
      </Card>
    </Collapsible>
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
    <div className="p-3 border-t border-primary bg-card shrink-0 space-y-3">
      {question.questions.map((q, qi) => (
        <div key={qi} className="space-y-2">
          <Badge variant="outline" className="text-[10px] text-primary">{q.header}</Badge>
          <p className="text-[13px]">{q.question}</p>
          <div className="flex flex-col gap-1">
            {q.options.map((opt, oi) => {
              const selected = q.multiSelect
                ? (selections[q.question] || '').split(', ').includes(opt.label)
                : selections[q.question] === opt.label && !useOther[q.question];
              return (
                <button
                  key={oi}
                  className={cn(
                    'flex flex-col items-start px-3 py-2 rounded-md border text-left w-full transition-colors',
                    selected
                      ? 'border-primary bg-primary/10'
                      : 'border-border bg-background hover:border-primary/50'
                  )}
                  onClick={() => handleSelect(q.question, opt.label, q.multiSelect)}
                >
                  <span className="text-xs font-semibold">{opt.label}</span>
                  <span className="text-[11px] text-muted-foreground">{opt.description}</span>
                </button>
              );
            })}
            <button
              className={cn(
                'flex flex-col items-start px-3 py-2 rounded-md border text-left w-full transition-colors',
                useOther[q.question]
                  ? 'border-primary bg-primary/10'
                  : 'border-border bg-background hover:border-primary/50'
              )}
              onClick={() => {
                setUseOther(prev => ({ ...prev, [q.question]: true }));
                setSelections(prev => ({ ...prev, [q.question]: '' }));
              }}
            >
              <span className="text-xs font-semibold">Other</span>
              <span className="text-[11px] text-muted-foreground">type your own answer</span>
            </button>
          </div>
          {useOther[q.question] && (
            <input
              className="w-full mt-1 px-3 py-2 bg-background border border-primary rounded-md text-xs outline-none placeholder:text-muted-foreground"
              placeholder="type your answer..."
              value={otherTexts[q.question] || ''}
              onChange={e => setOtherTexts(prev => ({ ...prev, [q.question]: e.target.value }))}
              autoFocus
            />
          )}
        </div>
      ))}
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onDismiss}>skip</Button>
        <Button size="sm" className="h-7 text-xs" onClick={handleSubmit} disabled={!allAnswered}>answer</Button>
      </div>
    </div>
  );
}

export function ChatView({ gateway }: Props) {
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const isRunning = gateway.agentStatus !== 'idle';

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
          <div key={i} className="flex gap-2 px-2 py-1.5 my-1 bg-secondary rounded-md">
            <span className="text-primary font-semibold shrink-0">{'>'}</span>
            <span className="text-foreground">{item.content}</span>
          </div>
        );
      case 'text':
        return (
          <div key={i} className="prose-chat py-0.5">
            <Markdown>{item.content}</Markdown>
            {item.streaming && <span className="streaming-cursor" />}
          </div>
        );
      case 'tool_use':
        return <ToolUseItem key={i} item={item} />;
      case 'thinking':
        return (
          <div key={i} className="text-muted-foreground italic text-xs border-l-2 border-border pl-2 my-1">
            {item.content}
            {item.streaming && <span className="streaming-cursor" />}
          </div>
        );
      case 'result':
        return (
          <div key={i} className="flex gap-2 text-[10px] text-muted-foreground py-1 mt-1 border-t border-border">
            {item.cost != null && <span>${item.cost.toFixed(4)}</span>}
            <span>{formatTime(item.timestamp)}</span>
          </div>
        );
      case 'error':
        return (
          <div key={i} className="text-destructive py-1">
            {item.content}
          </div>
        );
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border shrink-0">
        <span className="font-semibold text-sm">Chat</span>
        <span className="text-muted-foreground text-[11px]">
          {gateway.currentSessionId ? `session: ${gateway.currentSessionId.slice(0, 8)}` : 'new session'}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto h-6 text-[11px] px-2"
          onClick={gateway.newSession}
        >
          <Plus className="w-3 h-3 mr-1" />
          new
        </Button>
      </div>

      {/* messages */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="px-4 py-3">
          {gateway.chatItems.length === 0 && (
            <AuroraBackground className="h-full min-h-[300px]">
              <div className="text-center space-y-2">
                <div className="text-3xl opacity-30">_</div>
                <div className="text-muted-foreground text-sm">send a message to start</div>
                <div className="text-[10px] text-muted-foreground">
                  {gateway.connectionState === 'connected' ? 'connected to gateway' : 'waiting for gateway...'}
                </div>
              </div>
            </AuroraBackground>
          )}

          {gateway.chatItems.map((item, i) => renderItem(item, i))}
          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      {/* question panel */}
      {gateway.pendingQuestion && (
        <AskUserQuestionPanel
          question={gateway.pendingQuestion}
          onAnswer={gateway.answerQuestion}
          onDismiss={gateway.dismissQuestion}
        />
      )}

      {/* approval cards */}
      {gateway.pendingApprovals.length > 0 && (
        <div className="px-4 pt-2 shrink-0 space-y-2">
          {gateway.pendingApprovals.map(a => (
            <ApprovalUI
              key={a.requestId}
              requestId={a.requestId}
              toolName={a.toolName}
              input={a.input}
              timestamp={a.timestamp}
              onApprove={gateway.approveToolUse}
              onDeny={gateway.denyToolUse}
            />
          ))}
        </div>
      )}

      {/* input area */}
      <div className="px-4 py-3 border-t border-border shrink-0">
        <div className="flex gap-2 items-end">
          <Textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={gateway.connectionState === 'connected' ? 'type a message...' : 'waiting for gateway...'}
            disabled={gateway.connectionState !== 'connected'}
            className="flex-1 min-h-[40px] max-h-[200px] resize-none text-[13px]"
            rows={1}
          />
          {isRunning ? (
            <Button
              variant="destructive"
              size="sm"
              className="h-9 px-3"
              onClick={gateway.abortAgent}
            >
              <Square className="w-3.5 h-3.5 mr-1" />
              stop
            </Button>
          ) : (
            <Button
              size="sm"
              className="h-9 px-3"
              onClick={handleSend}
              disabled={!input.trim() || sending || gateway.connectionState !== 'connected'}
            >
              <Send className="w-3.5 h-3.5 mr-1" />
              send
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
