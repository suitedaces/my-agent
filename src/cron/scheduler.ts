import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { Config } from '../config.js';
import { runAgent } from '../agent.js';
import { parseDurationMs } from '../heartbeat/runner.js';

export type CronJob = {
  id: string;
  name: string;
  cron?: string;        // cron expression (5-field)
  every?: string;       // duration like "4h"
  at?: string;          // one-shot timestamp or relative like "20m"
  timezone?: string;
  message: string;
  session?: 'main' | 'isolated';
  model?: string;
  thinking?: 'low' | 'medium' | 'high';
  channel?: string;
  to?: string;
  deliver?: boolean;
  deleteAfterRun?: boolean;
  enabled?: boolean;
  createdAt: string;
  lastRunAt?: string;
  nextRunAt?: string;
};

type CronState = {
  jobs: CronJob[];
  timers: Map<string, NodeJS.Timeout>;
};

const CRON_FILE = join(homedir(), '.my-agent', 'cron-jobs.json');

function ensureCronDir(): void {
  const dir = join(homedir(), '.my-agent');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export function loadCronJobs(): CronJob[] {
  ensureCronDir();
  if (!existsSync(CRON_FILE)) return [];
  try {
    return JSON.parse(readFileSync(CRON_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

export function saveCronJobs(jobs: CronJob[]): void {
  ensureCronDir();
  writeFileSync(CRON_FILE, JSON.stringify(jobs, null, 2));
}

export function generateJobId(): string {
  return `cron-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

// parse 5-field cron expression
function parseCronExpression(cron: string): { minute: number[]; hour: number[]; dayOfMonth: number[]; month: number[]; dayOfWeek: number[] } | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;

  const parseField = (field: string, min: number, max: number): number[] | null => {
    if (field === '*') {
      return Array.from({ length: max - min + 1 }, (_, i) => min + i);
    }

    const values: number[] = [];

    for (const part of field.split(',')) {
      // handle ranges like 1-5
      if (part.includes('-')) {
        const [start, end] = part.split('-').map(Number);
        if (isNaN(start) || isNaN(end) || start < min || end > max) return null;
        for (let i = start; i <= end; i++) values.push(i);
        continue;
      }

      // handle steps like */5
      if (part.includes('/')) {
        const [range, stepStr] = part.split('/');
        const step = parseInt(stepStr, 10);
        if (isNaN(step) || step <= 0) return null;

        let rangeStart = min;
        let rangeEnd = max;
        if (range !== '*') {
          const n = parseInt(range, 10);
          if (isNaN(n)) return null;
          rangeStart = n;
        }

        for (let i = rangeStart; i <= rangeEnd; i += step) values.push(i);
        continue;
      }

      // simple number
      const n = parseInt(part, 10);
      if (isNaN(n) || n < min || n > max) return null;
      values.push(n);
    }

    return values.length > 0 ? [...new Set(values)].sort((a, b) => a - b) : null;
  };

  const minute = parseField(parts[0], 0, 59);
  const hour = parseField(parts[1], 0, 23);
  const dayOfMonth = parseField(parts[2], 1, 31);
  const month = parseField(parts[3], 1, 12);
  const dayOfWeek = parseField(parts[4], 0, 6);

  if (!minute || !hour || !dayOfMonth || !month || !dayOfWeek) return null;

  return { minute, hour, dayOfMonth, month, dayOfWeek };
}

function getNextCronRun(cron: string, timezone?: string): Date | null {
  const parsed = parseCronExpression(cron);
  if (!parsed) return null;

  const now = new Date();
  const tz = timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;

  // simple implementation: check next 366 days
  for (let dayOffset = 0; dayOffset < 366; dayOffset++) {
    const checkDate = new Date(now.getTime() + dayOffset * 24 * 60 * 60 * 1000);

    for (const hour of parsed.hour) {
      for (const minute of parsed.minute) {
        const candidate = new Date(checkDate);
        candidate.setHours(hour, minute, 0, 0);

        if (candidate <= now) continue;

        const month = candidate.getMonth() + 1;
        const dayOfMonth = candidate.getDate();
        const dayOfWeek = candidate.getDay();

        if (!parsed.month.includes(month)) continue;
        if (!parsed.dayOfMonth.includes(dayOfMonth) && !parsed.dayOfWeek.includes(dayOfWeek)) continue;

        return candidate;
      }
    }
  }

  return null;
}

function parseAtTime(at: string): Date | null {
  // relative time like "20m" or "2h"
  const ms = parseDurationMs(at);
  if (ms) {
    return new Date(Date.now() + ms);
  }

  // absolute ISO timestamp
  const date = new Date(at);
  if (!isNaN(date.getTime())) {
    return date;
  }

  return null;
}

export type CronRunner = {
  stop: () => void;
  addJob: (job: Omit<CronJob, 'id' | 'createdAt'>) => CronJob;
  removeJob: (id: string) => boolean;
  listJobs: () => CronJob[];
  runJobNow: (id: string) => Promise<{ status: string; result?: string }>;
};

export function startCronRunner(opts: {
  config: Config;
  onJobRun?: (job: CronJob, result: { status: string; result?: string }) => void;
}): CronRunner {
  const { config, onJobRun } = opts;
  const state: CronState = {
    jobs: loadCronJobs(),
    timers: new Map(),
  };
  let stopped = false;

  const scheduleJob = (job: CronJob) => {
    if (stopped || !job.enabled) return;

    // clear existing timer
    const existingTimer = state.timers.get(job.id);
    if (existingTimer) {
      clearTimeout(existingTimer);
      state.timers.delete(job.id);
    }

    let nextRun: Date | null = null;

    if (job.cron) {
      nextRun = getNextCronRun(job.cron, job.timezone);
    } else if (job.every) {
      const ms = parseDurationMs(job.every);
      if (ms) {
        const lastRun = job.lastRunAt ? new Date(job.lastRunAt).getTime() : Date.now();
        nextRun = new Date(lastRun + ms);
      }
    } else if (job.at) {
      nextRun = parseAtTime(job.at);
    }

    if (!nextRun || nextRun <= new Date()) return;

    job.nextRunAt = nextRun.toISOString();
    const delay = nextRun.getTime() - Date.now();

    const timer = setTimeout(async () => {
      if (stopped) return;

      try {
        const result = await runAgent({
          prompt: job.message,
          config: {
            ...config,
            model: job.model || config.model,
          },
        });

        job.lastRunAt = new Date().toISOString();

        onJobRun?.(job, { status: 'ran', result: result.result });

        if (job.deleteAfterRun) {
          state.jobs = state.jobs.filter(j => j.id !== job.id);
          state.timers.delete(job.id);
        } else {
          scheduleJob(job);
        }

        saveCronJobs(state.jobs);
      } catch (err) {
        onJobRun?.(job, { status: 'failed', result: String(err) });
      }
    }, delay);

    timer.unref?.();
    state.timers.set(job.id, timer);
  };

  // schedule all enabled jobs
  for (const job of state.jobs) {
    if (job.enabled !== false) {
      scheduleJob(job);
    }
  }

  console.log(`[cron] started with ${state.jobs.length} jobs`);

  return {
    stop: () => {
      stopped = true;
      for (const timer of state.timers.values()) {
        clearTimeout(timer);
      }
      state.timers.clear();
    },

    addJob: (jobData) => {
      const job: CronJob = {
        ...jobData,
        id: generateJobId(),
        createdAt: new Date().toISOString(),
        enabled: jobData.enabled !== false,
      };

      state.jobs.push(job);
      saveCronJobs(state.jobs);
      scheduleJob(job);

      return job;
    },

    removeJob: (id) => {
      const timer = state.timers.get(id);
      if (timer) {
        clearTimeout(timer);
        state.timers.delete(id);
      }

      const before = state.jobs.length;
      state.jobs = state.jobs.filter(j => j.id !== id);
      saveCronJobs(state.jobs);

      return state.jobs.length < before;
    },

    listJobs: () => [...state.jobs],

    runJobNow: async (id) => {
      const job = state.jobs.find(j => j.id === id);
      if (!job) {
        return { status: 'not-found' };
      }

      try {
        const result = await runAgent({
          prompt: job.message,
          config: {
            ...config,
            model: job.model || config.model,
          },
        });

        job.lastRunAt = new Date().toISOString();
        saveCronJobs(state.jobs);
        scheduleJob(job);

        return { status: 'ran', result: result.result };
      } catch (err) {
        return { status: 'failed', result: String(err) };
      }
    },
  };
}
