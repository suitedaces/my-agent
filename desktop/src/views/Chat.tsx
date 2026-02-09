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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Square, Plus, ChevronDown, ChevronRight, Sparkles,
  FileText, FilePlus, Pencil, FolderSearch, FileSearch, Terminal,
  Globe, Search, Bot, MessageCircle, ListChecks, FileCode,
  MessageSquare, Camera, Monitor, Clock, Wrench, ArrowUp,
  Smile, Image,
  type LucideIcon,
} from 'lucide-react';

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

const TOOL_ICONS: Record<string, LucideIcon> = {
  Read: FileText, Write: FilePlus, Edit: Pencil,
  Glob: FolderSearch, Grep: FileSearch, Bash: Terminal,
  WebFetch: Globe, WebSearch: Search, Task: Bot,
  AskUserQuestion: MessageCircle, TodoWrite: ListChecks, NotebookEdit: FileCode,
  message: MessageSquare, screenshot: Camera, browser: Monitor,
  schedule_reminder: Clock, schedule_recurring: Clock,
  schedule_cron: Clock, list_reminders: Clock, cancel_reminder: Clock,
};

function ToolUseItem({ item }: { item: Extract<ChatItem, { type: 'tool_use' }> }) {
  const [open, setOpen] = useState(false);
  const hasOutput = item.output != null;
  const isPending = item.streaming || !hasOutput;
  const displayName = toolText(item.name, isPending ? 'pending' : 'done');

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className="my-1 overflow-hidden border-border/50 max-w-md">
        <CollapsibleTrigger className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-secondary/50 transition-colors">
          {(() => {
            const Icon = TOOL_ICONS[item.name] || Wrench;
            if (item.streaming) return <Icon className="w-3 h-3 text-muted-foreground animate-pulse" />;
            if (hasOutput) return <Icon className={item.is_error ? 'w-3 h-3 text-destructive' : 'w-3 h-3 text-foreground'} />;
            return <Icon className="w-3 h-3 text-muted-foreground" />;
          })()}
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
              imageData={item.imageData}
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
  const [step, setStep] = useState(0);
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [otherTexts, setOtherTexts] = useState<Record<string, string>>({});
  const [useOther, setUseOther] = useState<Record<string, boolean>>({});

  const total = question.questions.length;
  const q = question.questions[step];

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
    for (const qq of question.questions) {
      if (useOther[qq.question] && otherTexts[qq.question]) {
        answers[qq.question] = otherTexts[qq.question];
      } else {
        answers[qq.question] = selections[qq.question] || '';
      }
    }
    onAnswer(question.requestId, answers);
  };

  const currentAnswered =
    (useOther[q.question] && otherTexts[q.question]) || selections[q.question];
  const isLast = step === total - 1;

  return (
    <div className="p-3 border-t border-primary bg-card shrink-0 space-y-3">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[10px] text-primary">{q.header}</Badge>
          {total > 1 && (
            <div className="flex items-center gap-1">
              {question.questions.map((_, i) => (
                <div
                  key={i}
                  className={cn(
                    'h-1.5 rounded-full transition-all',
                    i === step ? 'w-4 bg-primary' : i < step ? 'w-1.5 bg-primary/50' : 'w-1.5 bg-muted-foreground/30'
                  )}
                />
              ))}
            </div>
          )}
        </div>
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
      <div className="flex justify-between">
        <div>
          {step > 0 && (
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setStep(s => s - 1)}>back</Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={isLast ? handleSubmit : () => setStep(s => s + 1)}>skip</Button>
          {isLast ? (
            <Button size="sm" className="h-7 text-xs" onClick={handleSubmit} disabled={!currentAnswered}>answer</Button>
          ) : (
            <Button size="sm" className="h-7 text-xs" onClick={() => setStep(s => s + 1)} disabled={!currentAnswered}>next</Button>
          )}
        </div>
      </div>
    </div>
  );
}

const SUGGESTIONS: { icon: LucideIcon; label: string; prompt: string }[] = [
  { icon: Sparkles, label: 'personalize dorabot', prompt: 'help me personalize you' },
  { icon: Globe, label: 'browse the web', prompt: 'open https://news.ycombinator.com and summarize the top stories' },
  { icon: Image, label: 'generate an image', prompt: 'generate a cool image for me' },
  { icon: Smile, label: 'make a meme', prompt: 'make me a funny meme' },
  { icon: Clock, label: 'set a reminder', prompt: 'remind me in 30 minutes to take a break' },
  { icon: Camera, label: 'take a screenshot', prompt: 'take a screenshot of my screen' },
];

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'good morning';
  if (h < 17) return 'good afternoon';
  return 'good evening';
}

export function ChatView({ gateway }: Props) {
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const landingInputRef = useRef<HTMLTextAreaElement>(null);
  const isRunning = gateway.agentStatus !== 'idle';
  const isEmpty = gateway.chatItems.length === 0;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [gateway.chatItems]);

  useEffect(() => {
    if (isEmpty) {
      landingInputRef.current?.focus();
    } else {
      inputRef.current?.focus();
    }
  }, [isEmpty]);

  const handleSend = async (overridePrompt?: string) => {
    const prompt = overridePrompt || input.trim();
    if (!prompt || sending || gateway.pendingQuestion) return;

    if (!overridePrompt) setInput('');
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
          <div key={i} className="flex gap-2 px-2 py-1.5 my-1 bg-secondary rounded-md min-w-0">
            <span className="text-primary font-semibold shrink-0">{'>'}</span>
            <span className="text-foreground break-words min-w-0">{item.content}</span>
          </div>
        );
      case 'text':
        return (
          <div key={i} className="prose-chat py-1.5">
            <Markdown>{item.content}</Markdown>
            {item.streaming && <span className="streaming-cursor" />}
          </div>
        );
      case 'tool_use':
        return <div key={i} className="my-1.5"><ToolUseItem item={item} /></div>;
      case 'thinking':
        return (
          <div key={i} className="text-muted-foreground italic text-xs border-l-2 border-border pl-2 my-1 break-words min-w-0">
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
          <div key={i} className="text-destructive py-1 break-words min-w-0">
            {item.content}
          </div>
        );
    }
  };

  const connected = gateway.connectionState === 'connected';

  // landing page — centered input with suggestions
  if (isEmpty) {
    return (
      <div className="flex flex-col h-full min-h-0 min-w-0">
        {/* header */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border shrink-0 min-w-0">
          <span className="text-muted-foreground text-[11px] font-mono">new task</span>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
            onClick={gateway.newSession}
            title="new task"
          >
            <Plus className="w-3.5 h-3.5" />
          </Button>
        </div>

        <div className="flex-1 flex items-center justify-center min-h-0 min-w-0">
          <AuroraBackground className="w-full h-full">
            <div className="w-full max-w-2xl px-6 space-y-6">
              {/* greeting */}
              <div className="text-center space-y-2">
                <img src="/dorabot-computer.png" alt="dorabot" className="w-24 h-24 mx-auto dorabot-alive" />
                <h1 className="text-lg font-semibold text-foreground">{getGreeting()}</h1>
                <div className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
                  <div className={cn('w-1.5 h-1.5 rounded-full', connected ? 'bg-success' : 'bg-destructive')} />
                  {connected ? 'ready' : 'connecting...'}
                </div>
              </div>

              {/* centered input */}
              <Card className="rounded-2xl">
                <Textarea
                  ref={landingInputRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={connected ? 'what can i help with?' : 'waiting for gateway...'}
                  disabled={!connected}
                  className="w-full min-h-[80px] max-h-[200px] resize-none text-sm border-0 rounded-2xl bg-transparent shadow-none focus-visible:ring-0"
                  rows={2}
                />
                <div className="flex items-center px-3 pb-3">
                  <Select value={gateway.model} onValueChange={gateway.changeModel} disabled={!connected}>
                    <SelectTrigger size="sm" className="h-7 w-20 text-[11px] rounded-lg shadow-none">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper" align="start">
                      <SelectItem value="claude-opus-4-6" className="text-xs">opus</SelectItem>
                      <SelectItem value="claude-sonnet-4-5-20250929" className="text-xs">sonnet</SelectItem>
                      <SelectItem value="claude-haiku-4-5-20251001" className="text-xs">haiku</SelectItem>
                    </SelectContent>
                  </Select>
                  <span className="flex-1" />
                  <Button
                    size="sm"
                    className="h-8 w-8 p-0 rounded-lg"
                    onClick={() => { handleSend(); }}
                    disabled={!input.trim() || sending || !connected}
                  >
                    <ArrowUp className="w-4 h-4" />
                  </Button>
                </div>
              </Card>

              {/* suggestions */}
              {connected && (
                <div className="grid grid-cols-3 gap-2">
                  {SUGGESTIONS.map(s => (
                    <button
                      key={s.label}
                      onClick={() => handleSend(s.prompt)}
                      className="group flex items-center gap-2 px-3 py-2.5 rounded-lg border border-border/60 bg-card/50 hover:bg-card hover:border-primary/30 hover:shadow-sm transition-all text-left"
                    >
                      <s.icon className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
                      <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">{s.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </AuroraBackground>
        </div>
      </div>
    );
  }

  // conversation view — messages + bottom input
  return (
    <div className="flex flex-col h-full min-h-0 min-w-0">
      {/* header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border shrink-0 min-w-0">
        <span className="text-muted-foreground text-[11px] font-mono">
          {gateway.currentSessionId ? gateway.currentSessionId.slice(0, 8) : 'new task'}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
          onClick={gateway.newSession}
          title="new task"
        >
          <Plus className="w-3.5 h-3.5" />
        </Button>
      </div>

      {/* messages */}
      <ScrollArea className="flex-1 min-h-0 min-w-0">
        <div className="px-4 py-3 min-w-0 overflow-hidden">
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
      <div className="px-4 py-3 shrink-0 min-w-0">
        <Card className="rounded-2xl">
          <Textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={connected ? 'type a message...' : 'waiting for gateway...'}
            disabled={!connected || !!gateway.pendingQuestion}
            className="w-full min-h-[64px] max-h-[200px] resize-none text-[13px] border-0 rounded-2xl bg-transparent shadow-none focus-visible:ring-0"
            rows={2}
          />
          <div className="flex items-center px-3 pb-3">
            <Select value={gateway.model} onValueChange={gateway.changeModel} disabled={!connected}>
              <SelectTrigger size="sm" className="h-7 w-20 text-[11px] rounded-lg shadow-none">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" align="start">
                <SelectItem value="claude-opus-4-6" className="text-xs">opus</SelectItem>
                <SelectItem value="claude-sonnet-4-5-20250929" className="text-xs">sonnet</SelectItem>
                <SelectItem value="claude-haiku-4-5-20251001" className="text-xs">haiku</SelectItem>
              </SelectContent>
            </Select>
            <span className="flex-1" />
            {isRunning ? (
              <Button
                size="sm"
                variant="destructive"
                className="h-8 w-8 p-0 rounded-lg"
                onClick={gateway.abortAgent}
              >
                <Square className="w-3.5 h-3.5" />
              </Button>
            ) : (
              <Button
                size="sm"
                className="h-8 w-8 p-0 rounded-lg"
                onClick={() => { handleSend(); }}
                disabled={!input.trim() || sending || !connected}
              >
                <ArrowUp className="w-4 h-4" />
              </Button>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
