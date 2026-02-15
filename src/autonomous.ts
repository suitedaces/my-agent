import { getTodayMemoryDir, MEMORIES_DIR, WORKSPACE_DIR } from './workspace.js';

export const AUTONOMOUS_SCHEDULE_ID = 'autonomy-pulse';

const INTERVAL_TO_RRULE: Record<string, string> = {
  '15m': 'FREQ=MINUTELY;INTERVAL=15',
  '30m': 'FREQ=MINUTELY;INTERVAL=30',
  '1h': 'FREQ=HOURLY;INTERVAL=1',
  '2h': 'FREQ=HOURLY;INTERVAL=2',
};
export const PULSE_INTERVALS = Object.keys(INTERVAL_TO_RRULE);
export const DEFAULT_PULSE_INTERVAL = '30m';

export function pulseIntervalToRrule(interval: string): string {
  return INTERVAL_TO_RRULE[interval] || INTERVAL_TO_RRULE[DEFAULT_PULSE_INTERVAL];
}

export function rruleToPulseInterval(rrule: string): string {
  for (const [key, value] of Object.entries(INTERVAL_TO_RRULE)) {
    if (rrule === value) return key;
  }
  return DEFAULT_PULSE_INTERVAL;
}

export function buildAutonomousPrompt(timezone?: string): string {
  const todayDir = getTodayMemoryDir(timezone);

  return `This is an autonomous pulse. You have a fresh session each pulse. Memory files are your only continuity between runs.

## Bootstrap

1. Read ${WORKSPACE_DIR}/MEMORY.md for your working knowledge.
2. Read ${todayDir}/MEMORY.md if it exists to see what you've already done today.
3. Check active goals (goals_view).

## Decide what to do

Work through this list in priority order. Do what needs doing, then stop.

**Advance a goal.** If there's an approved or in-progress goal, take the next concrete step. Use the browser, run commands, do research, write code, whatever the goal requires. Update the goal status when done.

**Act on something you're monitoring.** Check a price, a deployment, a PR, a tracking page. If the state changed, act on it or notify the owner.

**Follow up with the owner.** If you asked them something and they answered (check journal), incorporate their answer. If they haven't answered and it's been a while, nudge them on an available channel.

**Research or prepare.** If a goal needs information before you can act, go get it. Use the browser, search the web, read files. Come back with findings, not questions.

**Get to know the owner.** If USER.md is mostly empty, use the onboard skill. One question per pulse.

**Propose new goals.** If you notice something worth doing (from memory, browsing, or context), propose it via goals_propose so the owner can approve it.

## After acting

- Write what you did and learned to ${todayDir}/MEMORY.md with a timestamp.
- If anything important changed, update ${WORKSPACE_DIR}/MEMORY.md.
- If something is urgent or the owner would want to know, message them on an available channel.

## Boundaries

- Stay focused. Do what's needed, don't spiral into tangents.
- Messages to the user should be concise. If you have litte information about the user, proactivbely ask them stuff using AskUserQuestion.
- If genuinely nothing needs attention (no goals, nothing to monitor, nothing pending), log "pulse, nothing to act on" and stop. But this should be rare if you're managing goals well.`;
}

export function buildAutonomousCalendarItem(timezone?: string, interval?: string) {
  return {
    type: 'event' as const,
    summary: 'Autonomy pulse',
    description: 'Periodic autonomy pulse',
    dtstart: new Date().toISOString(),
    rrule: pulseIntervalToRrule(interval || DEFAULT_PULSE_INTERVAL),
    timezone,
    message: buildAutonomousPrompt(timezone),
    session: 'main' as const,
    enabled: true,
    deleteAfterRun: false,
  };
}
