import { useState } from 'react';
import { useGateway } from './hooks/useGateway';
import { ChatView } from './views/Chat';
import { ChannelView } from './views/Channel';
import { Automations } from './components/Automations';
import { FileExplorer } from './components/FileExplorer';
import { FileViewer } from './components/FileViewer';
import { StatusView } from './views/Status';

type NavTab = 'chat' | 'whatsapp' | 'telegram' | 'automation' | 'status';

const NAV_ITEMS: { id: NavTab; label: string; icon: string }[] = [
  { id: 'chat', label: 'Chat', icon: '>' },
  { id: 'whatsapp', label: 'WhatsApp', icon: 'W' },
  { id: 'telegram', label: 'Telegram', icon: 'T' },
  { id: 'automation', label: 'Auto', icon: '*' },
  { id: 'status', label: 'Status', icon: '?' },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('chat');
  const [showFiles, setShowFiles] = useState(true);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const gw = useGateway();

  const renderView = () => {
    if (selectedFile) {
      return <FileViewer filePath={selectedFile} rpc={gw.rpc} onClose={() => setSelectedFile(null)} />;
    }

    switch (activeTab) {
      case 'chat':
        return <ChatView gateway={gw} />;
      case 'whatsapp':
        return <ChannelView channel="whatsapp" gateway={gw} />;
      case 'telegram':
        return <ChannelView channel="telegram" gateway={gw} />;
      case 'automation':
        return <Automations gateway={gw} />;
      case 'status':
        return <StatusView gateway={gw} />;
    }
  };

  return (
    <>
      <div className="titlebar">
        <span className="titlebar-title">my-agent</span>
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
                onClick={() => setActiveTab(item.id)}
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
              <div className="nav-label">sessions</div>
              {gw.sessions.slice(0, 20).map(s => (
                <button
                  key={s.id}
                  className={`nav-item session-item ${gw.currentSessionId === s.id ? 'active' : ''}`}
                  onClick={() => { gw.loadSession(s.id); setActiveTab('chat'); }}
                  title={`${s.messageCount} msgs — ${new Date(s.updatedAt).toLocaleString()}`}
                >
                  <span style={{ fontSize: 10, opacity: 0.6 }}>{s.id.slice(8, 16)}</span>
                  <span style={{ fontSize: 9, color: 'var(--text-muted)', marginLeft: 'auto' }}>
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
