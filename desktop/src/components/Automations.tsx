import { useState, useEffect } from 'react';
import type { useGateway } from '../hooks/useGateway';
import type { CronJob } from '../../../src/cron/scheduler';

type AutomationsProps = {
  gateway: ReturnType<typeof useGateway>;
};

export function Automations({ gateway }: AutomationsProps) {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newJob, setNewJob] = useState({
    name: '',
    message: '',
    type: 'one-time' as 'one-time' | 'recurring' | 'cron',
    at: '',
    every: '',
    cron: '',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });

  // load jobs
  const loadJobs = async () => {
    if (gateway.connectionState !== 'connected') return;
    try {
      const result = await gateway.rpc('cron.list');
      if (Array.isArray(result)) {
        setJobs(result);
      }
      setLoading(false);
    } catch (err) {
      console.error('Failed to load cron jobs:', err);
      setLoading(false);
    }
  };

  useEffect(() => {
    loadJobs();
  }, [gateway.connectionState]);

  const addJob = async () => {
    const jobData: any = {
      name: newJob.name || 'Unnamed Task',
      message: newJob.message,
      timezone: newJob.timezone,
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

      // reset form
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

      setTimeout(loadJobs, 100);
    } catch (err) {
      console.error('Failed to add job:', err);
    }
  };

  const toggleJob = async (id: string) => {
    try {
      await gateway.rpc('cron.toggle', { id });
      setTimeout(loadJobs, 100);
    } catch (err) {
      console.error('Failed to toggle job:', err);
    }
  };

  const runJobNow = async (id: string) => {
    try {
      await gateway.rpc('cron.run', { id });
    } catch (err) {
      console.error('Failed to run job:', err);
    }
  };

  const deleteJob = async (id: string) => {
    try {
      await gateway.rpc('cron.remove', { id });
      setTimeout(loadJobs, 100);
    } catch (err) {
      console.error('Failed to delete job:', err);
    }
  };

  const formatSchedule = (job: CronJob) => {
    if (job.cron) return `Cron: ${job.cron}`;
    if (job.every) return `Every ${job.every}`;
    if (job.at) return `At ${job.at}`;
    return 'Unknown';
  };

  if (gateway.connectionState !== 'connected') {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-neutral-400">Connecting to gateway...</div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-neutral-400">Loading automations...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-neutral-900">
      {/* header */}
      <div className="flex items-center justify-between p-4 border-b border-neutral-800">
        <div>
          <h2 className="text-lg font-semibold text-neutral-100">Automations</h2>
          <p className="text-sm text-neutral-400">
            Schedule tasks and reminders for the agent
          </p>
        </div>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
        >
          {showAddForm ? 'Cancel' : '+ New Automation'}
        </button>
      </div>

      {/* add form */}
      {showAddForm && (
        <div className="p-4 border-b border-neutral-800 bg-neutral-850">
          <div className="space-y-3 max-w-2xl">
            <div>
              <label className="block text-sm font-medium text-neutral-300 mb-1">
                Name
              </label>
              <input
                type="text"
                value={newJob.name}
                onChange={(e) => setNewJob({ ...newJob, name: e.target.value })}
                placeholder="Daily standup reminder"
                className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-neutral-100 placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-300 mb-1">
                Message / Task
              </label>
              <textarea
                value={newJob.message}
                onChange={(e) => setNewJob({ ...newJob, message: e.target.value })}
                placeholder="Check project status and send update to team"
                rows={3}
                className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-neutral-100 placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-300 mb-1">
                Schedule Type
              </label>
              <div className="flex gap-2">
                {(['one-time', 'recurring', 'cron'] as const).map((type) => (
                  <button
                    key={type}
                    onClick={() => setNewJob({ ...newJob, type })}
                    className={`px-4 py-2 rounded-lg border transition-colors ${
                      newJob.type === type
                        ? 'bg-blue-600 border-blue-600 text-white'
                        : 'bg-neutral-800 border-neutral-700 text-neutral-300 hover:border-neutral-600'
                    }`}
                  >
                    {type === 'one-time' ? 'One-Time' : type === 'recurring' ? 'Recurring' : 'Cron'}
                  </button>
                ))}
              </div>
            </div>

            {newJob.type === 'one-time' && (
              <div>
                <label className="block text-sm font-medium text-neutral-300 mb-1">
                  Run At
                </label>
                <input
                  type="text"
                  value={newJob.at}
                  onChange={(e) => setNewJob({ ...newJob, at: e.target.value })}
                  placeholder="20m, 2h, 1d, or ISO timestamp"
                  className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-neutral-100 placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="mt-1 text-xs text-neutral-500">
                  Examples: "20m" (20 minutes), "2h" (2 hours), "1d" (1 day)
                </p>
              </div>
            )}

            {newJob.type === 'recurring' && (
              <div>
                <label className="block text-sm font-medium text-neutral-300 mb-1">
                  Repeat Every
                </label>
                <input
                  type="text"
                  value={newJob.every}
                  onChange={(e) => setNewJob({ ...newJob, every: e.target.value })}
                  placeholder="30m, 4h, 1d"
                  className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-neutral-100 placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="mt-1 text-xs text-neutral-500">
                  Examples: "30m" (every 30 minutes), "4h" (every 4 hours), "1d" (daily)
                </p>
              </div>
            )}

            {newJob.type === 'cron' && (
              <div>
                <label className="block text-sm font-medium text-neutral-300 mb-1">
                  Cron Expression (5-field)
                </label>
                <input
                  type="text"
                  value={newJob.cron}
                  onChange={(e) => setNewJob({ ...newJob, cron: e.target.value })}
                  placeholder="0 9 * * *"
                  className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-neutral-100 placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                />
                <p className="mt-1 text-xs text-neutral-500">
                  Format: minute hour day month weekday. Example: "0 9 * * *" = 9am daily
                </p>
              </div>
            )}

            <button
              onClick={addJob}
              disabled={!newJob.message ||
                (newJob.type === 'one-time' && !newJob.at) ||
                (newJob.type === 'recurring' && !newJob.every) ||
                (newJob.type === 'cron' && !newJob.cron)}
              className="w-full px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-neutral-700 disabled:text-neutral-500 text-white rounded-lg transition-colors"
            >
              Create Automation
            </button>
          </div>
        </div>
      )}

      {/* jobs list */}
      <div className="flex-1 overflow-y-auto p-4">
        {jobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-neutral-400">
            <svg className="w-16 h-16 mb-4 text-neutral-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-lg font-medium">No automations yet</p>
            <p className="text-sm">Create your first automation to get started</p>
          </div>
        ) : (
          <div className="space-y-3">
            {jobs.map((job) => (
              <div
                key={job.id}
                className="bg-neutral-800 border border-neutral-700 rounded-lg p-4 hover:border-neutral-600 transition-colors"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-neutral-100 font-medium">{job.name}</h3>
                      <span className={`px-2 py-0.5 text-xs rounded ${
                        job.enabled === false
                          ? 'bg-red-500/20 text-red-400'
                          : 'bg-green-500/20 text-green-400'
                      }`}>
                        {job.enabled === false ? 'Disabled' : 'Enabled'}
                      </span>
                    </div>
                    <p className="text-sm text-neutral-400 mb-2">{job.message}</p>
                    <div className="flex items-center gap-4 text-xs text-neutral-500">
                      <span>📅 {formatSchedule(job)}</span>
                      {job.nextRunAt && (
                        <span>⏱️ Next: {new Date(job.nextRunAt).toLocaleString()}</span>
                      )}
                      {job.lastRunAt && (
                        <span>✓ Last: {new Date(job.lastRunAt).toLocaleString()}</span>
                      )}
                    </div>
                  </div>

                  <div className="flex gap-2 ml-4">
                    <button
                      onClick={() => toggleJob(job.id)}
                      className="px-3 py-1.5 bg-neutral-700 hover:bg-neutral-600 text-neutral-200 rounded text-sm transition-colors"
                      title={job.enabled === false ? 'Enable' : 'Disable'}
                    >
                      {job.enabled === false ? '▶️' : '⏸️'}
                    </button>
                    <button
                      onClick={() => runJobNow(job.id)}
                      className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm transition-colors"
                      title="Run now"
                    >
                      ▶️ Run
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(`Delete automation "${job.name}"?`)) {
                          deleteJob(job.id);
                        }
                      }}
                      className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded text-sm transition-colors"
                      title="Delete"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
