import { useState, useEffect, useCallback } from 'react';
import type { useGateway } from '../hooks/useGateway';
import type { CronJob } from '../../../src/cron/scheduler';

type AutomationsProps = {
  gateway: ReturnType<typeof useGateway>;
};

export function Automations({ gateway }: AutomationsProps) {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [expandedJob, setExpandedJob] = useState<string | null>(null);
  const [newJob, setNewJob] = useState({
    name: '',
    message: '',
    type: 'one-time' as 'one-time' | 'recurring' | 'cron',
    at: '',
    every: '',
    cron: '',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });

  const loadJobs = useCallback(async () => {
    if (gateway.connectionState !== 'connected') return;
    try {
      const result = await gateway.rpc('cron.list');
      if (Array.isArray(result)) setJobs(result);
      setLoading(false);
    } catch (err) {
      console.error('failed to load cron jobs:', err);
      setLoading(false);
    }
  }, [gateway.connectionState, gateway.rpc]);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  const resetForm = () => {
    setNewJob({
      name: '',
      message: '',
      type: 'one-time',
      at: '',
      every: '',
      cron: '',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    setShowAddForm(false);
  };

  const addJob = async () => {
    const jobData: Record<string, unknown> = {
      name: newJob.name || 'Unnamed Task',
      message: newJob.message,
      timezone: newJob.timezone,
      enabled: true,
    };

    if (newJob.type === 'one-time') {
      jobData.at = newJob.at;
      jobData.deleteAfterRun = true;
    } else if (newJob.type === 'recurring') {
      jobData.every = newJob.every;
    } else if (newJob.type === 'cron') {
      jobData.cron = newJob.cron;
    }

    try {
      await gateway.rpc('cron.add', jobData);
      resetForm();
      setTimeout(loadJobs, 100);
    } catch (err) {
      console.error('failed to add job:', err);
    }
  };

  const toggleJob = async (id: string) => {
    try {
      await gateway.rpc('cron.toggle', { id });
      setTimeout(loadJobs, 100);
    } catch (err) {
      console.error('failed to toggle job:', err);
    }
  };

  const runJobNow = async (id: string) => {
    try {
      await gateway.rpc('cron.run', { id });
      setTimeout(loadJobs, 500);
    } catch (err) {
      console.error('failed to run job:', err);
    }
  };

  const deleteJob = async (id: string) => {
    try {
      await gateway.rpc('cron.remove', { id });
      setTimeout(loadJobs, 100);
    } catch (err) {
      console.error('failed to delete job:', err);
    }
  };

  const formatSchedule = (job: CronJob) => {
    if (job.cron) return `cron: ${job.cron}`;
    if (job.every) return `every ${job.every}`;
    if (job.at) return `at ${job.at}`;
    return 'unknown';
  };

  const formatTime = (iso?: string) => {
    if (!iso) return null;
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  };

  const canSubmit = newJob.message && (
    (newJob.type === 'one-time' && newJob.at) ||
    (newJob.type === 'recurring' && newJob.every) ||
    (newJob.type === 'cron' && newJob.cron)
  );

  if (gateway.connectionState !== 'connected') {
    return <div className="empty-state"><span className="empty-state-icon">*</span>connecting...</div>;
  }

  if (loading) {
    return <div className="empty-state">loading automations...</div>;
  }

  return (
    <div className="auto-view">
      <div className="auto-header">
        <div>
          <span className="auto-title">Automations</span>
          <span className="auto-count">{jobs.length}</span>
        </div>
        <button className="btn btn-primary" onClick={() => setShowAddForm(!showAddForm)}>
          {showAddForm ? 'cancel' : '+ new'}
        </button>
      </div>

      {showAddForm && (
        <div className="auto-form">
          <div className="auto-form-row">
            <label className="auto-label">name</label>
            <input
              className="auto-input"
              type="text"
              value={newJob.name}
              onChange={e => setNewJob({ ...newJob, name: e.target.value })}
              placeholder="daily standup reminder"
            />
          </div>

          <div className="auto-form-row">
            <label className="auto-label">message / task</label>
            <textarea
              className="auto-input auto-textarea"
              value={newJob.message}
              onChange={e => setNewJob({ ...newJob, message: e.target.value })}
              placeholder="check project status and send update"
              rows={3}
            />
          </div>

          <div className="auto-form-row">
            <label className="auto-label">type</label>
            <div className="auto-type-buttons">
              {(['one-time', 'recurring', 'cron'] as const).map(type => (
                <button
                  key={type}
                  className={`auto-type-btn ${newJob.type === type ? 'active' : ''}`}
                  onClick={() => setNewJob({ ...newJob, type })}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>

          {newJob.type === 'one-time' && (
            <div className="auto-form-row">
              <label className="auto-label">run at</label>
              <input
                className="auto-input"
                type="text"
                value={newJob.at}
                onChange={e => setNewJob({ ...newJob, at: e.target.value })}
                placeholder="20m, 2h, 1d, or ISO timestamp"
              />
              <span className="auto-hint">relative (20m, 2h) or absolute (2025-01-15T09:00:00)</span>
            </div>
          )}

          {newJob.type === 'recurring' && (
            <div className="auto-form-row">
              <label className="auto-label">repeat every</label>
              <input
                className="auto-input"
                type="text"
                value={newJob.every}
                onChange={e => setNewJob({ ...newJob, every: e.target.value })}
                placeholder="30m, 4h, 1d"
              />
              <span className="auto-hint">30m = every 30 minutes, 4h = every 4 hours</span>
            </div>
          )}

          {newJob.type === 'cron' && (
            <div className="auto-form-row">
              <label className="auto-label">cron expression</label>
              <input
                className="auto-input"
                type="text"
                value={newJob.cron}
                onChange={e => setNewJob({ ...newJob, cron: e.target.value })}
                placeholder="0 9 * * *"
                style={{ fontFamily: 'var(--font-mono)' }}
              />
              <span className="auto-hint">minute hour day month weekday — "0 9 * * *" = 9am daily</span>
            </div>
          )}

          <button
            className="btn btn-primary auto-submit"
            onClick={addJob}
            disabled={!canSubmit}
          >
            create automation
          </button>
        </div>
      )}

      <div className="auto-list">
        {jobs.length === 0 ? (
          <div className="empty-state">
            <span className="empty-state-icon">*</span>
            <span>no automations yet</span>
          </div>
        ) : (
          jobs.map(job => (
            <div key={job.id} className="auto-job">
              <div className="auto-job-header" onClick={() => setExpandedJob(expandedJob === job.id ? null : job.id)}>
                <span className={`badge ${job.enabled === false ? 'disconnected' : 'connected'}`}>
                  {job.enabled === false ? 'off' : 'on'}
                </span>
                <span className="auto-job-name">{job.name}</span>
                <span className="auto-job-schedule">{formatSchedule(job)}</span>
                <span className="tool-chevron">{expandedJob === job.id ? 'v' : '>'}</span>
              </div>

              {expandedJob === job.id && (
                <div className="auto-job-detail">
                  <div className="auto-job-message">{job.message}</div>

                  <div className="auto-job-meta">
                    {job.nextRunAt && <span>next: {formatTime(job.nextRunAt)}</span>}
                    {job.lastRunAt && <span>last: {formatTime(job.lastRunAt)}</span>}
                    <span>created: {formatTime(job.createdAt)}</span>
                    {job.deleteAfterRun && <span className="auto-hint">one-shot</span>}
                  </div>

                  <div className="auto-job-actions">
                    <button className="btn" onClick={() => toggleJob(job.id)}>
                      {job.enabled === false ? 'enable' : 'disable'}
                    </button>
                    <button className="btn btn-primary" onClick={() => runJobNow(job.id)}>
                      run now
                    </button>
                    <button
                      className="btn auto-btn-danger"
                      onClick={() => { if (confirm(`delete "${job.name}"?`)) deleteJob(job.id); }}
                    >
                      delete
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
