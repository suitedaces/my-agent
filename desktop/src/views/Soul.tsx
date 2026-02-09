import { useState, useEffect, useCallback } from 'react';
import type { useGateway } from '../hooks/useGateway';
import ReactMarkdown from 'react-markdown';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { Sparkles, User, Brain, Save, RotateCcw, Loader2, Pencil, Eye, MessageSquare } from 'lucide-react';

type Props = {
  gateway: ReturnType<typeof useGateway>;
  onSetupChat?: (prompt: string) => void;
};

const WORKSPACE_DIR = '~/.dorabot/workspace';

const FILES = [
  { name: 'SOUL.md', label: 'Soul', icon: Sparkles, description: 'personality, tone, behavior guidelines' },
  { name: 'USER.md', label: 'User', icon: User, description: 'who you are, preferences, context about you' },
  { name: 'MEMORY.md', label: 'Memory', icon: Brain, description: 'persistent facts across sessions' },
] as const;

type FileState = {
  content: string;
  original: string;
  loading: boolean;
  saving: boolean;
  error: string | null;
};

const SETUP_PROMPTS: Record<string, string> = {
  'SOUL.md': 'Help me set up my agent\'s personality. Ask me about the tone, style, and behavior I want, then write it to ~/.dorabot/workspace/SOUL.md',
  'USER.md': 'Help me create my user profile. Ask me about myself — my name, what I do, my preferences — then write it to ~/.dorabot/workspace/USER.md',
  'MEMORY.md': 'Help me seed my agent\'s memory with key facts. Ask me what I want the agent to always remember, then write it to ~/.dorabot/workspace/MEMORY.md',
};

export function SoulView({ gateway, onSetupChat }: Props) {
  const disabled = gateway.connectionState !== 'connected';
  const [files, setFiles] = useState<Record<string, FileState>>({});
  const [activeFile, setActiveFile] = useState<(typeof FILES)[number]['name']>(FILES[0].name);
  const [editing, setEditing] = useState(false);

  const loadFile = useCallback(async (name: string) => {
    setFiles(prev => ({
      ...prev,
      [name]: { content: '', original: '', loading: true, saving: false, error: null },
    }));
    try {
      const res = await gateway.rpc('fs.read', { path: `${WORKSPACE_DIR}/${name}` }) as { content: string };
      const content = res?.content || '';
      setFiles(prev => ({
        ...prev,
        [name]: { content, original: content, loading: false, saving: false, error: null },
      }));
    } catch {
      setFiles(prev => ({
        ...prev,
        [name]: { content: '', original: '', loading: false, saving: false, error: null },
      }));
    }
  }, [gateway]);

  const saveFile = useCallback(async (name: string) => {
    const file = files[name];
    if (!file) return;
    setFiles(prev => ({ ...prev, [name]: { ...prev[name], saving: true, error: null } }));
    try {
      await gateway.rpc('fs.write', { path: `${WORKSPACE_DIR}/${name}`, content: file.content });
      setFiles(prev => ({ ...prev, [name]: { ...prev[name], original: prev[name].content, saving: false } }));
    } catch (err) {
      setFiles(prev => ({
        ...prev,
        [name]: { ...prev[name], saving: false, error: err instanceof Error ? err.message : 'save failed' },
      }));
    }
  }, [files, gateway]);

  const revert = useCallback((name: string) => {
    setFiles(prev => ({ ...prev, [name]: { ...prev[name], content: prev[name].original, error: null } }));
  }, []);

  useEffect(() => {
    if (disabled) return;
    for (const f of FILES) loadFile(f.name);
  }, [disabled, loadFile]);

  const file = files[activeFile];
  const isDirty = file && file.content !== file.original;
  const fileMeta = FILES.find(f => f.name === activeFile)!;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border shrink-0">
        <Sparkles className="w-4 h-4 text-primary" />
        <span className="font-semibold text-sm">Soul</span>
        <span className="text-[10px] text-muted-foreground ml-1">~/.dorabot/workspace/</span>
      </div>

      {/* file tabs */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border shrink-0">
        {FILES.map(({ name, label, icon: Icon }) => {
          const f = files[name];
          const dirty = f && f.content !== f.original;
          return (
            <button
              key={name}
              onClick={() => { setActiveFile(name); setEditing(false); }}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] transition-colors ${
                activeFile === name
                  ? 'bg-secondary text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
              }`}
            >
              <Icon className="w-3 h-3" />
              {label}
              {dirty && <span className="w-1.5 h-1.5 rounded-full bg-warning" />}
            </button>
          );
        })}

        <div className="ml-auto flex items-center gap-1">
          <Button
            variant={editing ? 'secondary' : 'ghost'}
            size="sm"
            className="h-6 text-[10px] px-2"
            onClick={() => setEditing(!editing)}
            disabled={disabled}
          >
            {editing ? <Eye className="w-3 h-3 mr-1" /> : <Pencil className="w-3 h-3 mr-1" />}
            {editing ? 'preview' : 'edit'}
          </Button>
          {editing && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="h-6 text-[10px] px-2"
                onClick={() => saveFile(activeFile)}
                disabled={disabled || !isDirty || file?.saving}
              >
                {file?.saving ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Save className="w-3 h-3 mr-1" />}
                save
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-[10px] px-2"
                onClick={() => revert(activeFile)}
                disabled={disabled || !isDirty}
              >
                <RotateCcw className="w-3 h-3 mr-1" />
                revert
              </Button>
            </>
          )}
        </div>
      </div>

      {/* description */}
      <div className="px-4 py-1.5 text-[10px] text-muted-foreground border-b border-border shrink-0">
        {fileMeta.description}
        {isDirty && <span className="text-warning ml-2">· unsaved changes</span>}
        {file?.error && <span className="text-destructive ml-2">· {file.error}</span>}
      </div>

      {/* content */}
      <div className="flex-1 min-h-0">
        {file?.loading ? (
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground p-4">
            <Loader2 className="w-3 h-3 animate-spin" />
            loading...
          </div>
        ) : editing ? (
          <ResizablePanelGroup orientation="horizontal">
            <ResizablePanel defaultSize="50%" minSize="30%">
              <Textarea
                value={file?.content || ''}
                onChange={e => setFiles(prev => ({
                  ...prev,
                  [activeFile]: { ...prev[activeFile], content: e.target.value, error: null },
                }))}
                placeholder={`write your ${fileMeta.label.toLowerCase()} here...`}
                className="w-full h-full font-mono text-[11px] text-foreground rounded-none border-0 resize-none focus-visible:ring-0 focus-visible:border-0 p-4"
                disabled={disabled}
              />
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel defaultSize="50%" minSize="20%">
              <ScrollArea className="h-full">
                <div className="markdown-viewer p-4 text-[12px]">
                  <ReactMarkdown>{file?.content || ''}</ReactMarkdown>
                </div>
              </ScrollArea>
            </ResizablePanel>
          </ResizablePanelGroup>
        ) : !file?.content ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-8">
            <fileMeta.icon className="w-8 h-8 text-muted-foreground/40" />
            <div className="text-sm text-muted-foreground">no {fileMeta.label.toLowerCase()} configured yet</div>
            <div className="flex gap-2">
              {onSetupChat && (
                <Button
                  variant="default"
                  size="sm"
                  className="h-7 text-[11px]"
                  onClick={() => onSetupChat(SETUP_PROMPTS[activeFile])}
                >
                  <MessageSquare className="w-3 h-3 mr-1.5" />
                  set up with task
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-[11px]"
                onClick={() => setEditing(true)}
              >
                <Pencil className="w-3 h-3 mr-1.5" />
                write manually
              </Button>
            </div>
          </div>
        ) : (
          <ScrollArea className="h-full">
            <div className="markdown-viewer p-4 text-[12px]">
              <ReactMarkdown>{file.content}</ReactMarkdown>
            </div>
          </ScrollArea>
        )}
      </div>
    </div>
  );
}
