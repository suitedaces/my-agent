import { useState, useMemo, useEffect, useRef } from 'react';
import { useGateway } from './hooks/useGateway';
import { ChatView } from './views/Chat';
import { ChannelView } from './views/Channel';
import { Automations } from './components/Automations';
import { FileExplorer } from './components/FileExplorer';
import { Progress } from './components/Progress';
import { FileViewer } from './components/FileViewer';
import { SettingsView } from './views/Settings';
import { SoulView } from './views/Soul';
import { Toaster, toast } from 'sonner';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import {
  MessageSquare, Radio, Zap, Brain, Settings2,
  FolderOpen
} from 'lucide-react';

type NavTab = 'chat' | 'channels' | 'automation' | 'memory' | 'settings';
type SessionFilter = 'all' | 'desktop' | 'telegram' | 'whatsapp';

const NAV_ITEMS: { id: NavTab; label: string; icon: React.ReactNode }[] = [
  { id: 'chat', label: 'Task', icon: <MessageSquare className="w-3.5 h-3.5" /> },
  { id: 'channels', label: 'Channels', icon: <Radio className="w-3.5 h-3.5" /> },
  { id: 'automation', label: 'Automations', icon: <Zap className="w-3.5 h-3.5" /> },
  { id: 'memory', label: 'Memory', icon: <Brain className="w-3.5 h-3.5" /> },
  { id: 'settings', label: 'Settings', icon: <Settings2 className="w-3.5 h-3.5" /> },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('chat');
  const [showFiles, setShowFiles] = useState(true);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [sessionFilter, setSessionFilter] = useState<SessionFilter>('all');
  const [selectedChannel, setSelectedChannel] = useState<'whatsapp' | 'telegram'>('whatsapp');
  const gw = useGateway();

  const prevNotifCount = useRef(0);
  useEffect(() => {
    if (gw.notifications.length > prevNotifCount.current) {
      const latest = gw.notifications[gw.notifications.length - 1];
      if (latest) {
        const name = latest.toolName.replace('mcp__dorabot__', '');
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
      case 'channels':
        return <ChannelView channel={selectedChannel} gateway={gw} onViewSession={handleViewSession} onSwitchChannel={setSelectedChannel} />;
      case 'automation':
        return <Automations gateway={gw} />;
      case 'memory':
        return <SoulView gateway={gw} onSetupChat={(prompt) => { gw.sendMessage(prompt); setActiveTab('chat'); }} />;
      case 'settings':
        return <SettingsView gateway={gw} />;
    }
  };

  const channelIcon = (ch?: string) => {
    if (ch === 'whatsapp') return <img src="/whatsapp.png" className="w-3 h-3" alt="W" />;
    if (ch === 'telegram') return <img src="/telegram.png" className="w-3 h-3" alt="T" />;
    return <MessageSquare className="w-3 h-3 opacity-50" />;
  };

  const statusDotColor = gw.connectionState === 'connected'
    ? 'bg-success'
    : gw.connectionState === 'connecting'
    ? 'bg-warning'
    : 'bg-destructive';

  return (
    <TooltipProvider delayDuration={300}>
      <Toaster
        position="top-right"
        toastOptions={{
          className: 'font-mono text-xs',
          style: { background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--foreground)' },
        }}
      />

      {/* titlebar — pure drag chrome */}
      <div className="h-9 bg-card border-b border-border flex items-center pl-[78px] pr-4 shrink-0" style={{ WebkitAppRegion: 'drag' } as any}>
        <span className="text-xs text-muted-foreground font-medium">dorabot</span>
      </div>

      {/* main layout */}
      <ResizablePanelGroup orientation="horizontal" className="flex-1 min-h-0">
        {/* sidebar */}
        <ResizablePanel defaultSize="15%" minSize="10%" maxSize="25%" className="bg-card overflow-hidden">
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
                      onClick={() => {
                        if (item.id === 'chat' && activeTab === 'chat' && gw.currentSessionId) {
                          gw.newSession();
                        }
                        setActiveTab(item.id);
                        setSelectedFile(null);
                      }}
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
                      <span className="w-3 h-3 shrink-0 flex items-center justify-center">{channelIcon(s.channel)}</span>
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

            {/* status at sidebar bottom */}
            <Separator className="shrink-0" />
            <div className="shrink-0 px-3 py-2 space-y-1">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${statusDotColor}`} />
                <span className="text-[10px] text-muted-foreground">{gw.connectionState}</span>
                <span className="text-[10px] text-muted-foreground ml-auto">{gw.agentStatus}</span>
              </div>
              <div className="text-[10px] text-muted-foreground">
                {gw.currentSessionId ? `session: ${gw.currentSessionId.slice(0, 8)}` : 'no session'}
              </div>
            </div>
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* main content */}
        <ResizablePanel defaultSize={showFiles ? "55%" : "85%"} minSize="30%" className="overflow-hidden">
          <div className="flex flex-col h-full min-h-0">
            {renderView()}
          </div>
        </ResizablePanel>

        {/* file explorer */}
        {showFiles && (
          <>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize="30%" minSize="15%" maxSize="45%" className="overflow-hidden flex flex-col">
              <Progress items={gw.progress} />
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
