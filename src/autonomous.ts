import { getTodayMemoryDir, MEMORIES_DIR, WORKSPACE_DIR } from './workspace.js';

export const AUTONOMOUS_SCHEDULE_ID = 'autonomous-checkin';

export function buildAutonomousPrompt(timezone?: string): string {
  const todayDir = getTodayMemoryDir(timezone);

  return `You're running autonomously. This is a scheduled check-in, not a user message.

1. Read ${WORKSPACE_DIR}/MEMORY.md for your working knowledge.
2. Read ${todayDir}/MEMORY.md if it exists to see what you've already done today.
3. Check active goals (goals_view).
4. Do whatever makes sense: check on things you're monitoring, follow up on pending items, research things you flagged, take actions on goals that are ready.
5. Write what you learned or did to ${todayDir}/MEMORY.md with a timestamp.
6. If anything important changed (new patterns, completed goals, key decisions), update MEMORY.md.
7. If something is urgent or noteworthy, message the owner on an available channel.

Don't do busywork. If nothing needs attention, append a short "checked in, nothing to act on" to today's journal and stop. The goal is useful work, not activity for its own sake.`;
}

export function buildAutonomousCalendarItem(timezone?: string) {
  return {
    type: 'event' as const,
    summary: 'Autonomous check-in',
    description: 'Periodic autonomous agent run',
    dtstart: new Date().toISOString(),
    rrule: 'FREQ=MINUTELY;INTERVAL=30',
    timezone,
    message: buildAutonomousPrompt(timezone),
    session: 'main' as const,
    enabled: true,
    deleteAfterRun: false,
  };
}
