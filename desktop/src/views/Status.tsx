import { useState, useEffect } from 'react';
import type { useGateway } from '../hooks/useGateway';

type Props = {
  gateway: ReturnType<typeof useGateway>;
};

export function StatusView({ gateway }: Props) {
  const [statusData, setStatusData] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    if (gateway.connectionState !== 'connected') return;
    gateway.rpc('status')
      .then(res => setStatusData(res as Record<string, unknown>))
      .catch(() => {});
  }, [gateway.connectionState, gateway.rpc]);

  return (
    <div className="chat-view">
      <div className="view-header">
        Status
        <span
          className={`badge ${gateway.connectionState === 'connected' ? 'connected' : 'disconnected'}`}
          style={{ marginLeft: 8 }}
        >
          {gateway.connectionState}
        </span>
      </div>
      <div className="view-body">
        {/* gateway */}
        <div className="card">
          <div className="card-title">Gateway</div>
          <div className="card-body">
            <div>connection: {gateway.connectionState}</div>
            <div>agent: {gateway.agentStatus}</div>
            <div>session: {gateway.currentSessionId || 'none'}</div>
          </div>
        </div>

        {/* channels */}
        <div className="card">
          <div className="card-title">Channels</div>
          <div className="card-body">
            {gateway.channelStatuses.length === 0 && (
              <div style={{ color: 'var(--text-muted)' }}>no channels configured</div>
            )}
            {gateway.channelStatuses.map(ch => (
              <div key={ch.channel} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                <span style={{ fontWeight: 600 }}>{ch.channel}</span>
                <span className={`badge ${ch.connected ? 'connected' : ch.running ? 'running' : 'disconnected'}`}>
                  {ch.connected ? 'connected' : ch.running ? 'connecting' : 'stopped'}
                </span>
                {ch.accountId && <span className="card-meta">{ch.accountId}</span>}
                {ch.lastError && <span style={{ color: 'var(--accent-red)', fontSize: 11 }}>{ch.lastError}</span>}
              </div>
            ))}
          </div>
        </div>

        {/* sessions */}
        <div className="card">
          <div className="card-title">Sessions</div>
          <div className="card-body">
            {gateway.sessions.length === 0 && (
              <div style={{ color: 'var(--text-muted)' }}>no sessions</div>
            )}
            {gateway.sessions.slice(0, 10).map(s => (
              <div
                key={s.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '4px 0',
                  cursor: 'pointer',
                  color: s.id === gateway.currentSessionId ? 'var(--accent-blue)' : 'var(--text-secondary)',
                }}
                onClick={() => gateway.setCurrentSessionId(s.id)}
              >
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{s.id.slice(0, 8)}</span>
                <span className="card-meta">{s.messageCount} msgs</span>
                <span className="card-meta">{s.updatedAt}</span>
              </div>
            ))}
          </div>
        </div>

        {/* raw status */}
        {statusData && (
          <div className="card">
            <div className="card-title">Raw Status</div>
            <div className="card-body">
              <pre style={{ whiteSpace: 'pre-wrap', fontSize: 11, color: 'var(--text-muted)' }}>
                {JSON.stringify(statusData, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
