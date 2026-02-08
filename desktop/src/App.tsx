import { useState, useMemo } from 'react';
import { useGateway } from './hooks/useGateway';
import { ChatView } from './views/Chat';
import { ChannelView } from './views/Channel';
import { Automations } from './components/Automations';
import { ToolsView } from './views/Tools';
import { FileExplorer } from './components/FileExplorer';
import { FileViewer } from './components/FileViewer';
import { StatusView } from './views/Status';
import { Toaster, toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { FlipWords } from '@/components/aceternity/flip-words';
import {
  MessageSquare, Phone, Send, Zap, Wrench, Activity,
  FolderOpen, Plus, ChevronRight
} from 'lucide-react';
import { useEffect, useRef } from 'react';

type NavTab = 'chat' | 'whatsapp' | 'telegram' | 'automation' | 'tools' | 'status';
type SessionFilter = 'all' | 'desktop' | 'telegram' | 'whatsapp';

const NAV_ITEMS: { id: NavTab; label: string; icon: React.ReactNode }[] = [
  { id: 'chat', label: 'Chat', icon: <MessageSquare className="w-3.5 h-3.5" /> },
  { id: 'whatsapp', label: 'WhatsApp', icon: <Phone className="w-3.5 h-3.5" /> },
  { id: 'telegram', label: 'Telegram', icon: <Send className="w-3.5 h-3.5" /> },
  { id: 'automation', label: 'Auto', icon: <Zap className="w-3.5 h-3.5" /> },
  { id: 'tools', label: 'Tools', icon: <Wrench className="w-3.5 h-3.5" /> },
  { id: 'status', label: 'Status', icon: <Activity className="w-3.5 h-3.5" /> },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('chat');
  const [showFiles, setShowFiles] = useState(true);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [sessionFilter, setSessionFilter] = useState<SessionFilter>('all');
  const gw = useGateway();

  // show tool notifications as toasts
  const prevNotifCount = useRef(0);
  useEffect(() => {
    if (gw.notifications.length > prevNotifCount.current) {
      const latest = gw.notifications[gw.notifications.length - 1];
      if (latest) {
        const name = latest.toolName.replace('mcp__my-agent__', '');
        toast(name, { description: 'executing...', duration: 3000 });
      }
    }
    prevNotifCount.current = gw.notifications.length;
  }, [gw.notifications]);

  const filteredSessions = useMemo(() => {
    if (sessionFilter === 'all') return gw.sessions;
    return gw.sessions.filter(s => (s.channel || 'desktop') === sessionFilter);
  }, [gw.sessions, sessionFilter]);

  const handleViewSession = (sessionId: string, channel?: string, chatId?: string) => {
    const sessionKey = channel && chatId
      ? `${channel}:dm:${chatId}`
      : 'desktop:dm:default';
    gw.loadSession(sessionId, sessionKey);
    setActiveTab('chat');
  };

  const renderView = () => {
    if (selectedFile) {
      return <FileViewer filePath={selectedFile} rpc={gw.rpc} onClose={() => setSelectedFile(null)} />;
    }

    switch (activeTab) {
      case 'chat':
        return <ChatView gateway={gw} />;
      case 'whatsapp':
        return <ChannelView channel="whatsapp" gateway={gw} onViewSession={handleViewSession} />;
      case 'telegram':
        return <ChannelView channel="telegram" gateway={gw} onViewSession={handleViewSession} />;
      case 'automation':
        return <Automations gateway={gw} />;
      case 'tools':
        return <ToolsView gateway={gw} />;
      case 'status':
        return <StatusView gateway={gw} />;
    }
  };

  const channelIcon = (ch?: string) => {
    if (ch === 'telegram') return 'T';
    if (ch === 'whatsapp') return 'W';
    return '>';
  };

  const statusDotColor = gw.connectionState === 'connected'
    ? 'bg-success'
    : gw.connectionState === 'connecting'
    ? 'bg-warning'
    : 'bg-destructive';

  const statusWords = gw.connectionState === 'connected'
    ? [gw.agentStatus]
    : [gw.connectionState];

  return (
    <TooltipProvider delayDuration={300}>
      <Toaster
        position="top-right"
        toastOptions={{
          className: 'font-mono text-xs',
          style: { background: 'oklch(0.17 0 0)', border: '1px solid oklch(0.3 0 0)', color: 'oklch(0.925 0 0)' },
        }}
      />

      {/* titlebar */}
      <div className="h-9 bg-card border-b border-border flex items-center px-4 pr-20 shrink-0" style={{ WebkitAppRegion: 'drag' } as any}>
        <span className="text-xs text-muted-foreground font-medium">my-agent</span>

        <div style={{ WebkitAppRegion: 'no-drag' } as any} className="ml-3">
          <Select value={gw.model} onValueChange={gw.changeModel} disabled={gw.connectionState !== 'connected'}>
            <SelectTrigger className="h-6 w-24 text-[11px] bg-background border-border">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="claude-opus-4-6" className="text-[11px]">opus</SelectItem>
              <SelectItem value="claude-sonnet-4-5-20250929" className="text-[11px]">sonnet</SelectItem>
              <SelectItem value="claude-haiku-4-5-20251001" className="text-[11px]">haiku</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="ml-auto flex items-center gap-2 text-[11px]" style={{ WebkitAppRegion: 'no-drag' } as any}>
          <div className={`w-2 h-2 rounded-full ${statusDotColor}`} />
          {statusWords.length > 1 ? (
            <FlipWords words={statusWords} duration={2000} className="text-muted-foreground" />
          ) : (
            <span className="text-muted-foreground">{statusWords[0]}</span>
          )}
        </div>
      </div>

      {/* main layout */}
      <ResizablePanelGroup orientation="horizontal" className="flex-1 min-h-0">
        {/* sidebar */}
        <ResizablePanel defaultSize="15" minSize="10" maxSize="25" className="bg-card overflow-hidden">
          <div className="flex flex-col h-full min-h-0">
            <div className="shrink-0 p-2">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground px-2.5 pt-3 pb-1">views</div>
              {NAV_ITEMS.map(item => (
                <Tooltip key={item.id}>
                  <TooltipTrigger asChild>
                    <button
                      className={`flex items-center gap-2 w-full px-2.5 py-1.5 rounded-md text-xs transition-colors ${
                        activeTab === item.id
                          ? 'bg-secondary text-foreground'
                          : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground'
                      }`}
                      onClick={() => { setActiveTab(item.id); setSelectedFile(null); }}
                    >
                      {item.icon}
                      {item.label}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="text-[10px]">{item.label}</TooltipContent>
                </Tooltip>
              ))}

              <div className="text-[10px] uppercase tracking-wider text-muted-foreground px-2.5 pt-4 pb-1">tools</div>
              <button
                className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-md text-xs text-muted-foreground hover:bg-secondary/50 hover:text-foreground transition-colors"
                onClick={() => setShowFiles(f => !f)}
              >
                <FolderOpen className="w-3.5 h-3.5" />
                Files {showFiles ? '(on)' : '(off)'}
              </button>
            </div>

            {/* sessions */}
            {gw.sessions.length > 0 && (
              <>
                <Separator />
                <div className="shrink-0 px-2 pt-1">
                  <div className="flex items-center px-2.5 py-1">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">sessions</span>
                    <select
                      value={sessionFilter}
                      onChange={e => setSessionFilter(e.target.value as SessionFilter)}
                      className="ml-auto text-[9px] bg-secondary text-muted-foreground border border-border rounded px-1 py-0.5"
                    >
                      <option value="all">all</option>
                      <option value="desktop">desktop</option>
                      <option value="telegram">telegram</option>
                      <option value="whatsapp">whatsapp</option>
                    </select>
                  </div>
                </div>
                <ScrollArea className="flex-1 min-h-0 px-2 pb-2">
                  {filteredSessions.slice(0, 30).map(s => (
                    <button
                      key={s.id}
                      className={`flex items-center gap-1.5 w-full px-2.5 py-1 rounded-md text-[10px] transition-colors ${
                        gw.currentSessionId === s.id
                          ? 'bg-secondary text-foreground'
                          : 'text-muted-foreground hover:bg-secondary/50'
                      }`}
                      onClick={() => handleViewSession(s.id, s.channel, s.chatId)}
                      title={`${s.channel || 'desktop'} | ${s.messageCount} msgs | ${new Date(s.updatedAt).toLocaleString()}`}
                    >
                      <span className="text-[9px] font-bold w-3 opacity-50">{channelIcon(s.channel)}</span>
                      <span className="truncate flex-1 text-left">
                        {s.senderName || s.chatId || s.id.slice(8, 16)}
                      </span>
                      <span className="text-[9px] text-muted-foreground shrink-0">
                        {new Date(s.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                      </span>
                    </button>
                  ))}
                </ScrollArea>
              </>
            )}

            <Separator className="shrink-0" />
            <div className="shrink-0 px-3 py-2 text-[10px] text-muted-foreground">
              {gw.currentSessionId ? `session: ${gw.currentSessionId.slice(0, 8)}` : 'no session'}
            </div>
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* main content */}
        <ResizablePanel defaultSize={showFiles ? "55" : "85"} minSize="30" className="overflow-hidden">
          <div className="flex flex-col h-full min-h-0">
            {renderView()}
          </div>
        </ResizablePanel>

        {/* file explorer */}
        {showFiles && (
          <>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize="30" minSize="15" maxSize="45" className="overflow-hidden">
              <FileExplorer
                rpc={gw.rpc}
                connected={gw.connectionState === 'connected'}
                onFileClick={setSelectedFile}
                onFileChange={gw.onFileChange}
              />
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
    </TooltipProvider>
  );
}
