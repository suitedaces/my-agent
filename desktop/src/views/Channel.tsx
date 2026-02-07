import { useMemo } from 'react';
import type { useGateway } from '../hooks/useGateway';

type Props = {
  channel: 'whatsapp' | 'telegram';
  gateway: ReturnType<typeof useGateway>;
  onViewSession?: (sessionId: string, channel?: string, chatId?: string) => void;
};

export function ChannelView({ channel, gateway, onViewSession }: Props) {
  const status = gateway.channelStatuses.find(s => s.channel === channel);
  const messages = useMemo(
    () => gateway.channelMessages.filter(m => m.channel === channel),
    [gateway.channelMessages, channel]
  );

  const channelSessions = useMemo(
    () => gateway.sessions.filter(s => s.channel === channel),
    [gateway.sessions, channel]
  );

  const label = channel === 'whatsapp' ? 'WhatsApp' : 'Telegram';

  const statusBadge = () => {
    if (!status) return <span className="badge">not configured</span>;
    if (status.connected) return <span className="badge connected">connected</span>;
    if (status.running) return <span className="badge running">connecting...</span>;
    return <span className="badge disconnected">disconnected</span>;
  };

  const formatTime = (ts: number) => {
    return new Date(ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
  };

  // group live messages by chatId
  const grouped = useMemo(() => {
    const groups = new Map<string, typeof messages>();
    for (const msg of messages) {
      const list = groups.get(msg.chatId) || [];
      list.push(msg);
      groups.set(msg.chatId, list);
    }
    return Array.from(groups.entries());
  }, [messages]);

  return (
    <div className="chat-view">
      <div className="chat-header">
        <span style={{ fontWeight: 600, fontSize: 14 }}>{label}</span>
        <span style={{ marginLeft: 8 }}>{statusBadge()}</span>
        {status?.accountId && (
          <span style={{ color: 'var(--text-muted)', fontSize: 11, marginLeft: 8 }}>
            {status.accountId}
          </span>
        )}
        {status?.lastError && (
          <span style={{ color: 'var(--accent-red)', fontSize: 11, marginLeft: 8 }}>
            {status.lastError}
          </span>
        )}
      </div>

      <div className="view-body">
        {channelSessions.length === 0 && messages.length === 0 && (
          <div className="empty-state">
            <div className="empty-state-icon">{channel === 'whatsapp' ? 'W' : 'T'}</div>
            <div>no {label} conversations yet</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
              {!status ? `configure ${label} in your config to get started` :
               status.connected ? 'waiting for incoming messages...' :
               'channel is not connected'}
            </div>
          </div>
        )}

        {channelSessions.length > 0 && (
          <>
            <div className="nav-label">conversations</div>
            {channelSessions.map(s => (
              <button
                key={s.id}
                className="card"
                style={{ cursor: 'pointer', marginBottom: 8, width: '100%', textAlign: 'left' }}
                onClick={() => onViewSession?.(s.id, s.channel, s.chatId)}
              >
                <div className="card-title" style={{ color: 'var(--accent-blue)' }}>
                  {s.senderName || s.chatId || s.id.slice(0, 16)}
                </div>
                <div className="card-meta">
                  {s.messageCount} messages — last {new Date(s.updatedAt).toLocaleString()}
                </div>
              </button>
            ))}
          </>
        )}

        {grouped.length > 0 && (
          <>
            <div className="nav-label" style={{ marginTop: channelSessions.length > 0 ? 16 : 0 }}>live feed</div>
            {grouped.map(([chatId, msgs]) => (
              <div key={chatId} className="card" style={{ marginBottom: 12 }}>
                <div className="card-title" style={{ color: 'var(--accent-blue)' }}>
                  {msgs[0]?.senderName || chatId}
                </div>
                <div className="card-meta">{chatId}</div>
                <div className="card-body">
                  {msgs.slice(-10).map(msg => (
                    <div key={msg.id} className="channel-message">
                      <div className="channel-message-header">
                        <span className="channel-message-sender">{msg.senderName || msg.senderId}</span>
                        <span className="channel-message-time">{formatTime(msg.timestamp)}</span>
                      </div>
                      <div className="channel-message-body">{msg.body}</div>
                      {msg.response && (
                        <div className="channel-message-response">{msg.response}</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
