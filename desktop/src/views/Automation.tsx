import { useState, useEffect } from 'react';
import type { useGateway } from '../hooks/useGateway';

type Props = {
  gateway: ReturnType<typeof useGateway>;
};

type CronJob = {
  id: string;
  name: string;
  cron?: string;
  every?: string;
  at?: string;
  enabled: boolean;
  lastRun?: string;
};

type HeartbeatInfo = {
  enabled: boolean;
  interval: string;
  lastRun?: string;
  lastResult?: string;
};

export function AutomationView({ gateway }: Props) {
  const [heartbeat, setHeartbeat] = useState<HeartbeatInfo | null>(null);
  const [cronJobs, setCronJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (gateway.connectionState !== 'connected') return;

    const fetchData = async () => {
      try {
        const [hb, cron] = await Promise.all([
          gateway.rpc('heartbeat.status').catch(() => null),
          gateway.rpc('cron.list').catch(() => null),
        ]);

        if (hb) setHeartbeat(hb as HeartbeatInfo);
        if (cron) {
          const c = cron as { jobs: CronJob[] };
          setCronJobs(c.jobs || []);
        }
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [gateway.connectionState, gateway.rpc]);

  const runHeartbeat = async () => {
    try {
      await gateway.rpc('heartbeat.run');
    } catch {}
  };

  const toggleCron = async (jobId: string, enabled: boolean) => {
    try {
      await gateway.rpc('cron.toggle', { jobId, enabled });
      setCronJobs(prev => prev.map(j => j.id === jobId ? { ...j, enabled } : j));
    } catch {}
  };

  const runCron = async (jobId: string) => {
    try {
      await gateway.rpc('cron.run', { jobId });
    } catch {}
  };

  if (gateway.connectionState !== 'connected') {
    return (
      <div className="chat-view">
        <div className="view-header">Automation</div>
        <div className="empty-state">
          <div>waiting for gateway connection...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-view">
      <div className="view-header">Automation</div>
      <div className="view-body">
        {/* heartbeat */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div className="card-title">Heartbeat</div>
            <span className={`badge ${heartbeat?.enabled ? 'connected' : 'disconnected'}`}>
              {heartbeat?.enabled ? 'on' : 'off'}
            </span>
            <span className="card-meta" style={{ marginLeft: 'auto' }}>
              {heartbeat?.interval || 'every 30m'}
            </span>
          </div>
          {heartbeat?.lastResult && (
            <div className="card-body">
              last: {heartbeat.lastResult}
            </div>
          )}
          <div style={{ marginTop: 8 }}>
            <button className="btn" onClick={runHeartbeat}>run now</button>
          </div>
        </div>

        {/* cron */}
        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontWeight: 600 }}>Cron Jobs</span>
            <span className="card-meta">{cronJobs.length} jobs</span>
          </div>

          {cronJobs.length === 0 && !loading && (
            <div className="card">
              <div className="card-body" style={{ color: 'var(--text-muted)' }}>
                no cron jobs configured
              </div>
            </div>
          )}

          {cronJobs.map(job => (
            <div key={job.id} className="card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div className="card-title">{job.name}</div>
                <span className="card-meta">{job.cron || job.every || job.at}</span>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                  <button className="btn" style={{ fontSize: 10 }} onClick={() => runCron(job.id)}>
                    run
                  </button>
                  <button
                    className={`toggle ${job.enabled ? 'on' : ''}`}
                    onClick={() => toggleCron(job.id, !job.enabled)}
                  />
                </div>
              </div>
              {job.lastRun && (
                <div className="card-meta" style={{ marginTop: 4 }}>
                  last: {job.lastRun}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
