import rrule from 'rrule';
const { RRule } = rrule;
import type { Config } from '../config.js';
import { runAgent } from '../agent.js';
export function parseDurationMs(duration: string): number | null {
  const match = duration.match(/^(\d+)(ms|s|m|h|d)?$/i);
  if (!match) return null;
  const value = parseInt(match[1], 10);
  const unit = (match[2] || 'm').toLowerCase();
  const multipliers: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return value * (multipliers[unit] || 60_000);
}
import { getDb } from '../db.js';

export type CalendarItemType = 'event' | 'todo' | 'reminder';

export type CalendarItem = {
  id: string;
  type: CalendarItemType;
  summary: string;
  description?: string;

  // iCal temporal properties — agent writes these directly
  dtstart: string;              // ISO 8601
  dtend?: string;               // ISO 8601, for time-bound events
  due?: string;                 // ISO 8601, for VTODO
  rrule?: string;               // raw RRULE: "FREQ=WEEKLY;BYDAY=MO,WE,FR"
  timezone?: string;            // IANA timezone

  // VALARM
  valarm?: number;              // trigger offset in seconds, e.g. -900 = 15min before

  // agent execution
  message: string;
  session?: 'main' | 'isolated';
  model?: string;
  thinking?: 'low' | 'medium' | 'high';
  channel?: string;
  to?: string;
  deliver?: boolean;

  // lifecycle
  enabled?: boolean;
  deleteAfterRun?: boolean;
  createdAt: string;
  lastRunAt?: string;
  nextRunAt?: string;
};

// --- DB helpers ---

export function loadCalendarItems(): CalendarItem[] {
  const db = getDb();
  const rows = db.prepare('SELECT data FROM calendar_items').all() as { data: string }[];
  return rows.map(r => JSON.parse(r.data));
}

function insertCalendarItem(item: CalendarItem): void {
  const db = getDb();
  db.prepare('INSERT OR REPLACE INTO calendar_items (id, data) VALUES (?, ?)').run(item.id, JSON.stringify(item));
}

function updateCalendarItemDb(item: CalendarItem): void {
  const db = getDb();
  db.prepare('UPDATE calendar_items SET data = ? WHERE id = ?').run(JSON.stringify(item), item.id);
}

function deleteCalendarItemDb(id: string): void {
  const db = getDb();
  db.prepare('DELETE FROM calendar_items WHERE id = ?').run(id);
}

export function generateItemId(): string {
  return `cal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

// --- RRULE next-run computation ---

function computeNextRun(item: CalendarItem): Date | null {
  const now = new Date();

  if (item.rrule) {
    try {
      const dtstart = new Date(item.dtstart);
      const rruleStr = `DTSTART:${formatRRuleDate(dtstart)}\nRRULE:${item.rrule}`;
      const rule = RRule.fromString(rruleStr);
      return rule.after(now, false); // strictly after now
    } catch {
      return null;
    }
  }

  // one-shot: just dtstart
  const dt = new Date(item.dtstart);
  if (dt > now) return dt;

  return null;
}

function formatRRuleDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

// --- ICS export ---

export function generateIcsString(items: CalendarItem[]): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//dorabot//scheduler//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Dorabot Schedule',
  ];

  for (const item of items) {
    if (item.type === 'todo') {
      lines.push('BEGIN:VTODO');
      lines.push(`UID:${item.id}`);
      lines.push(`SUMMARY:${escapeIcal(item.summary)}`);
      if (item.description) lines.push(`DESCRIPTION:${escapeIcal(item.description)}`);
      lines.push(`DTSTART:${toIcalDate(item.dtstart)}`);
      if (item.due) lines.push(`DUE:${toIcalDate(item.due)}`);
      if (item.rrule) lines.push(`RRULE:${item.rrule}`);
      if (item.timezone) lines.push(`TZID:${item.timezone}`);
      lines.push(`CREATED:${toIcalDate(item.createdAt)}`);
      lines.push('END:VTODO');
    } else {
      lines.push('BEGIN:VEVENT');
      lines.push(`UID:${item.id}`);
      lines.push(`SUMMARY:${escapeIcal(item.summary)}`);
      if (item.description) lines.push(`DESCRIPTION:${escapeIcal(item.description)}`);
      lines.push(`DTSTART:${toIcalDate(item.dtstart)}`);
      if (item.dtend) lines.push(`DTEND:${toIcalDate(item.dtend)}`);
      if (item.rrule) lines.push(`RRULE:${item.rrule}`);
      if (item.timezone) lines.push(`TZID:${item.timezone}`);
      lines.push(`CREATED:${toIcalDate(item.createdAt)}`);

      if (item.valarm != null) {
        lines.push('BEGIN:VALARM');
        lines.push('ACTION:DISPLAY');
        lines.push(`DESCRIPTION:${escapeIcal(item.summary)}`);
        lines.push(`TRIGGER:${formatDuration(item.valarm)}`);
        lines.push('END:VALARM');
      }

      lines.push('END:VEVENT');
    }
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

function escapeIcal(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function toIcalDate(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function formatDuration(seconds: number): string {
  const abs = Math.abs(seconds);
  const sign = seconds < 0 ? '-' : '';
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const s = abs % 60;
  let dur = `${sign}PT`;
  if (h > 0) dur += `${h}H`;
  if (m > 0) dur += `${m}M`;
  if (s > 0 || (h === 0 && m === 0)) dur += `${s}S`;
  return dur;
}

// --- Migration from cron_jobs ---

export function migrateCronToCalendar(): void {
  const db = getDb();

  // check if old table exists and has data
  const tableExists = db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='cron_jobs'"
  ).get();
  if (!tableExists) return;

  const oldRows = db.prepare('SELECT data FROM cron_jobs').all() as { data: string }[];
  if (oldRows.length === 0) return;

  // backfill any cron jobs that are missing in calendar_items
  const existingRows = db.prepare('SELECT id FROM calendar_items').all() as { id: string }[];
  const existingIds = new Set(existingRows.map(r => r.id));
  let migrated = 0;

  for (const row of oldRows) {
    const old = JSON.parse(row.data) as Record<string, any>;
    if (existingIds.has(old.id)) continue;

    let dtstart: string;
    if (old.at) {
      const ms = parseDurationMs(old.at);
      dtstart = ms ? new Date(Date.now() + ms).toISOString() : new Date(old.at).toISOString();
    } else if (old.nextRunAt) {
      dtstart = old.nextRunAt;
    } else {
      dtstart = new Date().toISOString();
    }

    const item: CalendarItem = {
      id: old.id,
      type: old.deleteAfterRun ? 'reminder' : 'event',
      summary: old.name || 'Migrated Task',
      dtstart,
      rrule: convertCronToRrule(old.cron) || convertEveryToRrule(old.every) || undefined,
      timezone: old.timezone,
      message: old.message,
      session: old.session,
      model: old.model,
      thinking: old.thinking,
      channel: old.channel,
      to: old.to,
      deliver: old.deliver,
      deleteAfterRun: old.deleteAfterRun,
      enabled: old.enabled,
      createdAt: old.createdAt || new Date().toISOString(),
      lastRunAt: old.lastRunAt,
      nextRunAt: old.nextRunAt,
    };

    insertCalendarItem(item);
    existingIds.add(item.id);
    migrated++;
  }

  if (migrated > 0) {
    console.log(`[calendar] migrated ${migrated} legacy cron jobs to calendar items`);
  }
}

function convertCronToRrule(cron?: string): string | null {
  if (!cron) return null;
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [min, hour, dom, , dow] = parts;
  const dayMap = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

  const rruleParts: string[] = [];

  if (dow !== '*') {
    rruleParts.push('FREQ=WEEKLY');
    const days = dow.split(',').map(d => dayMap[parseInt(d, 10)] || d);
    rruleParts.push(`BYDAY=${days.join(',')}`);
  } else if (dom !== '*') {
    rruleParts.push('FREQ=MONTHLY');
    rruleParts.push(`BYMONTHDAY=${dom}`);
  } else {
    rruleParts.push('FREQ=DAILY');
  }

  if (hour !== '*') rruleParts.push(`BYHOUR=${hour}`);
  if (min !== '*') rruleParts.push(`BYMINUTE=${min}`);

  return rruleParts.join(';');
}

function convertEveryToRrule(every?: string): string | null {
  if (!every) return null;
  const ms = parseDurationMs(every);
  if (!ms) return null;
  const seconds = ms / 1000;
  if (seconds < 60) return `FREQ=SECONDLY;INTERVAL=${seconds}`;
  const minutes = seconds / 60;
  if (minutes < 60) return `FREQ=MINUTELY;INTERVAL=${minutes}`;
  const hours = minutes / 60;
  if (hours < 24) return `FREQ=HOURLY;INTERVAL=${hours}`;
  const days = hours / 24;
  return `FREQ=DAILY;INTERVAL=${days}`;
}

// --- Tick-based scheduler ---

const DEFAULT_TICK_MS = 30_000;

export type SchedulerRunner = {
  stop: () => void;
  addItem: (item: Omit<CalendarItem, 'id' | 'createdAt'> & { id?: string }) => CalendarItem;
  updateItem: (id: string, updates: Partial<Omit<CalendarItem, 'id' | 'createdAt'>>) => CalendarItem | null;
  removeItem: (id: string) => boolean;
  listItems: () => CalendarItem[];
  runItemNow: (id: string) => Promise<{ status: string; result?: string }>;
  exportIcs: () => string;
};

export type SchedulerContext = {
  connectedChannels?: { channel: string; chatId: string }[];
  timezone?: string;
};

export type AgentRunResult = {
  sessionId: string;
  result: string;
  messages: unknown[];
  usage: { inputTokens: number; outputTokens: number; totalCostUsd: number };
  durationMs: number;
  usedMessageTool?: boolean;
};

export function startScheduler(opts: {
  config: Config;
  tickIntervalMs?: number;
  getContext?: () => SchedulerContext;
  onItemStart?: (item: CalendarItem) => void;
  onItemRun?: (item: CalendarItem, result: { status: string; result?: string; sessionId?: string; usage?: { inputTokens: number; outputTokens: number; totalCostUsd: number }; durationMs?: number; messaged?: boolean }) => void;
  runItem?: (item: CalendarItem, config: Config, context: SchedulerContext) => Promise<AgentRunResult>;
}): SchedulerRunner {
  const { config, onItemRun, onItemStart } = opts;
  const tickMs = opts.tickIntervalMs ?? config.calendar?.tickIntervalMs ?? DEFAULT_TICK_MS;
  let items = loadCalendarItems();
  let stopped = false;
  const running = new Set<string>();

  // compute nextRunAt for all enabled items on startup
  const now = Date.now();
  for (const item of items) {
    if (item.enabled !== false) {
      // never ran + created in the last 60s = brand new, fire immediately
      const isNew = !item.lastRunAt && (now - new Date(item.createdAt).getTime()) < 60_000;
      if (isNew) {
        item.nextRunAt = new Date().toISOString();
      } else {
        const next = computeNextRun(item);
        item.nextRunAt = next?.toISOString();
      }
      updateCalendarItemDb(item);
    }
  }

  const defaultRunItem = async (item: CalendarItem, cfg: Config, ctx: SchedulerContext): Promise<AgentRunResult> => {
    const result = await runAgent({
      prompt: item.message,
      config: cfg,
      connectedChannels: ctx.connectedChannels,
      timezone: ctx.timezone,
    });
    return result;
  };
  const runFn = opts.runItem || defaultRunItem;

  const executeItem = async (item: CalendarItem) => {
    try {
      onItemStart?.(item);
      const ctx = opts.getContext?.() || {};
      const itemConfig = { ...config, model: item.model || config.model };
      const result = await runFn(item, itemConfig, ctx);

      item.lastRunAt = new Date().toISOString();
      onItemRun?.(item, {
        status: 'ran',
        result: result.result,
        sessionId: result.sessionId,
        usage: result.usage,
        durationMs: result.durationMs,
        messaged: result.usedMessageTool,
      });

      if (item.deleteAfterRun) {
        items = items.filter(i => i.id !== item.id);
        deleteCalendarItemDb(item.id);
      } else {
        const next = computeNextRun(item);
        item.nextRunAt = next?.toISOString();

        // non-recurring item that already fired — disable
        if (!item.nextRunAt && !item.rrule) {
          item.enabled = false;
        }
        updateCalendarItemDb(item);
      }
    } catch (err) {
      onItemRun?.(item, { status: 'failed', result: String(err) });
    }
  };

  const tick = () => {
    if (stopped) return;
    const now = Date.now();

    for (const item of items) {
      if (item.enabled === false) continue;
      if (running.has(item.id)) continue;
      if (!item.nextRunAt) continue;

      if (new Date(item.nextRunAt).getTime() <= now) {
        running.add(item.id);
        executeItem(item).finally(() => running.delete(item.id));
      }
    }
  };

  const timer = setInterval(tick, tickMs);
  timer.unref?.();

  // immediate tick to catch up missed items
  tick();

  console.log(`[calendar] started with ${items.length} items (tick: ${tickMs}ms)`);

  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },

    addItem: (data) => {
      const item: CalendarItem = {
        ...data,
        id: data.id || generateItemId(),
        createdAt: new Date().toISOString(),
        enabled: data.enabled !== false,
      };

      const next = computeNextRun(item);
      item.nextRunAt = next?.toISOString();

      items.push(item);
      insertCalendarItem(item);
      return item;
    },

    updateItem: (id, updates) => {
      const item = items.find(i => i.id === id);
      if (!item) return null;

      Object.assign(item, updates);
      const next = computeNextRun(item);
      item.nextRunAt = next?.toISOString();
      updateCalendarItemDb(item);
      return item;
    },

    removeItem: (id) => {
      const before = items.length;
      items = items.filter(i => i.id !== id);
      deleteCalendarItemDb(id);
      return items.length < before;
    },

    listItems: () => [...items],

    runItemNow: async (id) => {
      const item = items.find(i => i.id === id);
      if (!item) return { status: 'not-found' };

      try {
        onItemStart?.(item);
        const ctx = opts.getContext?.() || {};
        const itemConfig = { ...config, model: item.model || config.model };
        const result = await runFn(item, itemConfig, ctx);

        item.lastRunAt = new Date().toISOString();
        const next = computeNextRun(item);
        item.nextRunAt = next?.toISOString();
        updateCalendarItemDb(item);

        const runResult = {
          status: 'ran',
          result: result.result,
          sessionId: result.sessionId,
          usage: result.usage,
          durationMs: result.durationMs,
          messaged: result.usedMessageTool,
        };
        onItemRun?.(item, runResult);
        return runResult;
      } catch (err) {
        onItemRun?.(item, { status: 'failed', result: String(err) });
        return { status: 'failed', result: String(err) };
      }
    },

    exportIcs: () => generateIcsString(items),
  };
}
