import { useState, useMemo } from 'react';
import { useGateway } from './hooks/useGateway';
import { ChatView } from './views/Chat';
import { ChannelView } from './views/Channel';
import { Automations } from './components/Automations';
import { ToolsView } from './views/Tools';
import { FileExplorer } from './components/FileExplorer';
import { FileViewer } from './components/FileViewer';
import { StatusView } from './views/Status';

type NavTab = 'chat' | 'whatsapp' | 'telegram' | 'automation' | 'tools' | 'status';

const NAV_ITEMS: { id: NavTab; label: string; icon: string }[] = [
  { id: 'chat', label: 'Chat', icon: '>' },
  { id: 'whatsapp', label: 'WhatsApp', icon: 'W' },
  { id: 'telegram', label: 'Telegram', icon: 'T' },
  { id: 'automation', label: 'Auto', icon: '*' },
  { id: 'tools', label: 'Tools', icon: '🔧' },
  { id: 'status', label: 'Status', icon: '?' },
];

type SessionFilter = 'all' | 'desktop' | 'telegram' | 'whatsapp';

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('chat');
  const [showFiles, setShowFiles] = useState(true);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [sessionFilter, setSessionFilter] = useState<SessionFilter>('all');
  const gw = useGateway();

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

  return (
    <>
      <div className="titlebar">
        <span className="titlebar-title">my-agent</span>
        <select
          className="model-selector"
          value={gw.model}
          onChange={e => gw.changeModel(e.target.value)}
          disabled={gw.connectionState !== 'connected'}
        >
          <option value="claude-opus-4-6">opus</option>
          <option value="claude-sonnet-4-5-20250929">sonnet</option>
          <option value="claude-haiku-4-5-20251001">haiku</option>
        </select>
        <div className="titlebar-status">
          <span className={`status-dot ${gw.connectionState}`} />
          <span>{gw.connectionState === 'connected' ? gw.agentStatus : gw.connectionState}</span>
        </div>
      </div>

      <div className="layout">
        <div className="sidebar">
          <div className="sidebar-nav">
            <div className="nav-label">views</div>
            {NAV_ITEMS.map(item => (
              <button
                key={item.id}
                className={`nav-item ${activeTab === item.id ? 'active' : ''}`}
                onClick={() => { setActiveTab(item.id); setSelectedFile(null); }}
              >
                <span style={{ fontWeight: 700, width: 16, textAlign: 'center' }}>{item.icon}</span>
                {item.label}
              </button>
            ))}

            <div className="nav-label" style={{ marginTop: 16 }}>tools</div>
            <button
              className="nav-item"
              onClick={() => setShowFiles(f => !f)}
            >
              <span style={{ fontWeight: 700, width: 16, textAlign: 'center' }}>{showFiles ? '-' : '+'}</span>
              Files {showFiles ? '(on)' : '(off)'}
            </button>
          </div>

          {gw.sessions.length > 0 && (
            <div className="sidebar-sessions">
              <div className="nav-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                sessions
                <select
                  value={sessionFilter}
                  onChange={e => setSessionFilter(e.target.value as SessionFilter)}
                  style={{ fontSize: 9, background: 'var(--bg-secondary)', color: 'var(--text-muted)', border: '1px solid var(--border)', borderRadius: 3, padding: '1px 2px', marginLeft: 'auto' }}
                >
                  <option value="all">all</option>
                  <option value="desktop">desktop</option>
                  <option value="telegram">telegram</option>
                  <option value="whatsapp">whatsapp</option>
                </select>
              </div>
              {filteredSessions.slice(0, 30).map(s => (
                <button
                  key={s.id}
                  className={`nav-item session-item ${gw.currentSessionId === s.id ? 'active' : ''}`}
                  onClick={() => handleViewSession(s.id, s.channel, s.chatId)}
                  title={`${s.channel || 'desktop'} | ${s.messageCount} msgs | ${new Date(s.updatedAt).toLocaleString()}`}
                >
                  <span style={{ fontSize: 9, fontWeight: 700, width: 12, opacity: 0.5 }}>{channelIcon(s.channel)}</span>
                  <span style={{ fontSize: 10, opacity: 0.8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                    {s.senderName || s.chatId || s.id.slice(8, 16)}
                  </span>
                  <span style={{ fontSize: 9, color: 'var(--text-muted)', flexShrink: 0 }}>
                    {new Date(s.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </span>
                </button>
              ))}
            </div>
          )}

          <div style={{ padding: '8px 10px', borderTop: '1px solid var(--border)', fontSize: 10, color: 'var(--text-muted)' }}>
            {gw.currentSessionId ? `session: ${gw.currentSessionId.slice(0, 8)}` : 'no session'}
          </div>
        </div>

        <div className="main-content">
          {renderView()}
        </div>

        {showFiles && (
          <FileExplorer
            rpc={gw.rpc}
            connected={gw.connectionState === 'connected'}
            onFileClick={setSelectedFile}
            onFileChange={gw.onFileChange}
          />
        )}
      </div>
    </>
  );
}
