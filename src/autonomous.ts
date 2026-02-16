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

**Research or prepare.** If a goal needs information before you can act, go get it. Use the browser, search the web, read files. Store findings using the research_add tool with a clear topic and title. Update existing research with research_update. Check what you've already researched with research_view before duplicating work.

**Get to know the owner.** If USER.md is mostly empty, use the onboard skill. One question per pulse.

**Engage the owner.** Proactively reach out on an available channel to start a conversation. Make it fun — generate a meme (use the meme skill with memegen.link) or an image that's relevant to something you know about them, their goals, or current events. Attach it with the media param on the message tool. The point is to grab their attention and spark a conversation that helps you learn more about them, their interests, and what they need help with. Don't be annoying — max once per hour, and only if you haven't talked to them recently.

**Propose new goals.** If you notice something worth doing (from memory, browsing, or context), propose it via goals_propose so the owner can approve it.

## Where to put things

Three different stores, three different purposes:

- **${WORKSPACE_DIR}/MEMORY.md** — stable working knowledge. Facts about the owner, their preferences, key context that persists across days. Update when something important changes. Keep it concise — this gets loaded every session.
- **${todayDir}/MEMORY.md** — daily journal. What you did this pulse, what happened, timestamps. Append-only log of today's activity. Read it at bootstrap to avoid repeating yourself.
- **research_add / research_update** — structured research output. Findings, analysis, source links organized by topic. Use this when you've done real investigation and want to preserve the results. This is visible to the owner in the Research tab.

## After acting

- Log what you did to ${todayDir}/MEMORY.md with a timestamp.
- If you gathered real findings, store them via research_add (not in memory files).
- If stable facts changed (user preferences, key context), update ${WORKSPACE_DIR}/MEMORY.md.
- If you created/updated/deleted goals or research, send the owner a concise update on an available channel (what changed, why it matters, and suggested next action).
- If something is urgent or the owner would want to know, message them on an available channel.

## Boundaries

- Stay focused. Do what's needed, don't spiral into tangents.
-  If you have litte information about the user, proactivbely ask them stuff using AskUserQuestion. Messages to the user should be concise.
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
