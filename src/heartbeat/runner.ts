import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Config } from '../config.js';
import { runAgent } from '../agent.js';

export const HEARTBEAT_TOKEN = 'HEARTBEAT_OK';
export const DEFAULT_HEARTBEAT_EVERY = '30m';
export const DEFAULT_HEARTBEAT_FILENAME = 'HEARTBEAT.md';
export const DEFAULT_HEARTBEAT_ACK_MAX_CHARS = 300;

export const DEFAULT_HEARTBEAT_PROMPT =
  'Read HEARTBEAT.md if it exists (workspace context). Follow it strictly. Do not infer or repeat old tasks from prior chats. If nothing needs attention, reply HEARTBEAT_OK.';

export type HeartbeatConfig = {
  enabled?: boolean;
  every?: string;
  prompt?: string;
  target?: 'last' | 'none' | string;
  ackMaxChars?: number;
  activeHours?: {
    start?: string; // HH:MM
    end?: string;   // HH:MM
    timezone?: string;
  };
  session?: string;
  model?: string;
  includeReasoning?: boolean;
};

export type HeartbeatRunResult = {
  status: 'ran' | 'skipped' | 'failed';
  reason?: string;
  durationMs?: number;
};

type HeartbeatState = {
  lastRunMs?: number;
  nextDueMs: number;
  intervalMs: number;
  lastHeartbeatText?: string;
  lastHeartbeatSentAt?: number;
};

let heartbeatsEnabled = true;
let heartbeatTimer: NodeJS.Timeout | null = null;
let heartbeatState: HeartbeatState | null = null;

export function setHeartbeatsEnabled(enabled: boolean): void {
  heartbeatsEnabled = enabled;
}

export function parseDurationMs(duration: string): number | null {
  const match = duration.match(/^(\d+)(ms|s|m|h|d)?$/i);
  if (!match) return null;

  const value = parseInt(match[1], 10);
  const unit = (match[2] || 'm').toLowerCase();

  const multipliers: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };

  return value * (multipliers[unit] || 60 * 1000);
}

export function isHeartbeatContentEffectivelyEmpty(content: string | undefined | null): boolean {
  if (!content || typeof content !== 'string') return false;

  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // skip markdown headers
    if (/^#+(\s|$)/.test(trimmed)) continue;
    // skip empty list items
    if (/^[-*+]\s*(\[[\sXx]?\]\s*)?$/.test(trimmed)) continue;
    // found actionable content
    return false;
  }
  return true;
}

function isWithinActiveHours(config: HeartbeatConfig): boolean {
  const active = config.activeHours;
  if (!active?.start || !active?.end) return true;

  const parseTime = (time: string): number | null => {
    const match = time.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return null;
    return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
  };

  const startMin = parseTime(active.start);
  const endMin = parseTime(active.end);
  if (startMin === null || endMin === null) return true;

  const now = new Date();
  const tz = active.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;

  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);

    const map: Record<string, string> = {};
    for (const part of parts) {
      if (part.type !== 'literal') map[part.type] = part.value;
    }

    const currentMin = parseInt(map.hour, 10) * 60 + parseInt(map.minute, 10);

    if (endMin > startMin) {
      return currentMin >= startMin && currentMin < endMin;
    }
    // wraps midnight
    return currentMin >= startMin || currentMin < endMin;
  } catch {
    return true;
  }
}

function stripHeartbeatToken(text: string, maxAckChars: number): { shouldSkip: boolean; text: string } {
  if (!text) return { shouldSkip: true, text: '' };

  const trimmed = text.trim();
  if (!trimmed.includes(HEARTBEAT_TOKEN)) {
    return { shouldSkip: false, text: trimmed };
  }

  // strip token from edges
  let result = trimmed;
  while (result.startsWith(HEARTBEAT_TOKEN)) {
    result = result.slice(HEARTBEAT_TOKEN.length).trim();
  }
  while (result.endsWith(HEARTBEAT_TOKEN)) {
    result = result.slice(0, -HEARTBEAT_TOKEN.length).trim();
  }

  if (!result) return { shouldSkip: true, text: '' };
  if (result.length <= maxAckChars) return { shouldSkip: true, text: '' };

  return { shouldSkip: false, text: result };
}

export async function runHeartbeatOnce(opts: {
  config: Config;
  heartbeat?: HeartbeatConfig;
  reason?: string;
  onMessage?: (text: string) => void;
}): Promise<HeartbeatRunResult> {
  const { config, heartbeat = config.heartbeat, reason, onMessage } = opts;
  const startedAt = Date.now();

  if (!heartbeatsEnabled || !heartbeat?.enabled) {
    return { status: 'skipped', reason: 'disabled' };
  }

  const intervalMs = parseDurationMs(heartbeat.every || DEFAULT_HEARTBEAT_EVERY);
  if (!intervalMs) {
    return { status: 'skipped', reason: 'invalid-interval' };
  }

  if (!isWithinActiveHours(heartbeat)) {
    return { status: 'skipped', reason: 'quiet-hours' };
  }

  // check HEARTBEAT.md
  const heartbeatFilePath = join(config.cwd, DEFAULT_HEARTBEAT_FILENAME);
  if (existsSync(heartbeatFilePath)) {
    const content = readFileSync(heartbeatFilePath, 'utf-8');
    if (isHeartbeatContentEffectivelyEmpty(content)) {
      return { status: 'skipped', reason: 'empty-heartbeat-file' };
    }
  }

  const prompt = heartbeat.prompt || DEFAULT_HEARTBEAT_PROMPT;
  const ackMaxChars = heartbeat.ackMaxChars ?? DEFAULT_HEARTBEAT_ACK_MAX_CHARS;

  try {
    const result = await runAgent({
      prompt,
      config: {
        ...config,
        model: heartbeat.model || config.model,
      },
      onMessage: (msg) => {
        const m = msg as Record<string, unknown>;
        if (m.type === 'assistant' && m.message) {
          const content = (m.message as any).content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === 'text' && onMessage) {
                onMessage(block.text);
              }
            }
          }
        }
      },
    });

    const stripped = stripHeartbeatToken(result.result, ackMaxChars);

    // check for duplicate
    if (heartbeatState?.lastHeartbeatText === stripped.text &&
        heartbeatState.lastHeartbeatSentAt &&
        startedAt - heartbeatState.lastHeartbeatSentAt < 24 * 60 * 60 * 1000) {
      return { status: 'skipped', reason: 'duplicate', durationMs: Date.now() - startedAt };
    }

    if (stripped.shouldSkip) {
      return { status: 'ran', reason: 'heartbeat-ok', durationMs: Date.now() - startedAt };
    }

    // deliver message
    if (onMessage) {
      onMessage(stripped.text);
    }

    // update state
    if (heartbeatState) {
      heartbeatState.lastHeartbeatText = stripped.text;
      heartbeatState.lastHeartbeatSentAt = startedAt;
    }

    return { status: 'ran', durationMs: Date.now() - startedAt };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { status: 'failed', reason, durationMs: Date.now() - startedAt };
  }
}

export type HeartbeatRunner = {
  stop: () => void;
  runNow: (reason?: string) => Promise<HeartbeatRunResult>;
  updateConfig: (config: Config) => void;
};

export function startHeartbeatRunner(opts: {
  config: Config;
  onMessage?: (text: string) => void;
  onEvent?: (event: { status: string; reason?: string; durationMs?: number }) => void;
}): HeartbeatRunner {
  const { config: initialConfig, onMessage, onEvent } = opts;
  let config = initialConfig;
  let stopped = false;

  const heartbeat = config.heartbeat;
  const intervalMs = parseDurationMs(heartbeat?.every || DEFAULT_HEARTBEAT_EVERY) || 30 * 60 * 1000;

  heartbeatState = {
    nextDueMs: Date.now() + intervalMs,
    intervalMs,
  };

  const scheduleNext = () => {
    if (stopped || !heartbeatState) return;

    if (heartbeatTimer) {
      clearTimeout(heartbeatTimer);
    }

    const delay = Math.max(0, heartbeatState.nextDueMs - Date.now());
    heartbeatTimer = setTimeout(async () => {
      if (stopped) return;

      const result = await runHeartbeatOnce({
        config,
        reason: 'interval',
        onMessage,
      });

      onEvent?.({
        status: result.status,
        reason: result.reason,
        durationMs: result.durationMs,
      });

      if (heartbeatState) {
        heartbeatState.lastRunMs = Date.now();
        heartbeatState.nextDueMs = Date.now() + heartbeatState.intervalMs;
      }

      scheduleNext();
    }, delay);

    heartbeatTimer.unref?.();
  };

  if (heartbeat?.enabled) {
    console.log(`[heartbeat] started, interval: ${heartbeat.every || DEFAULT_HEARTBEAT_EVERY}`);
    scheduleNext();
  }

  return {
    stop: () => {
      stopped = true;
      if (heartbeatTimer) {
        clearTimeout(heartbeatTimer);
        heartbeatTimer = null;
      }
    },

    runNow: async (reason = 'manual') => {
      const result = await runHeartbeatOnce({
        config,
        reason,
        onMessage,
      });

      onEvent?.({
        status: result.status,
        reason: result.reason,
        durationMs: result.durationMs,
      });

      if (heartbeatState) {
        heartbeatState.lastRunMs = Date.now();
        heartbeatState.nextDueMs = Date.now() + heartbeatState.intervalMs;
      }

      scheduleNext();
      return result;
    },

    updateConfig: (newConfig: Config) => {
      config = newConfig;
      const newHeartbeat = newConfig.heartbeat;
      const newIntervalMs = parseDurationMs(newHeartbeat?.every || DEFAULT_HEARTBEAT_EVERY) || 30 * 60 * 1000;

      if (heartbeatState) {
        heartbeatState.intervalMs = newIntervalMs;
      }

      if (newHeartbeat?.enabled && !heartbeat?.enabled) {
        scheduleNext();
      } else if (!newHeartbeat?.enabled && heartbeatTimer) {
        clearTimeout(heartbeatTimer);
        heartbeatTimer = null;
      }
    },
  };
}
