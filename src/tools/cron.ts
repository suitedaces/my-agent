import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import type { CronRunner } from '../cron/scheduler.js';

// global reference to cron runner (set by gateway)
let cronRunner: CronRunner | null = null;

export function setCronRunner(runner: CronRunner): void {
  cronRunner = runner;
}

export function getCronRunner(): CronRunner | null {
  return cronRunner;
}

export const scheduleReminderTool = tool(
  'schedule_reminder',
  'Schedule a one-time reminder or task. Use when user says "remind me in X minutes/hours" or "do X at Y time".',
  {
    message: z.string().describe('The reminder message or task description'),
    delay: z.string().describe('Duration like "20m", "2h", "1d" OR absolute time like "2024-12-25T09:00:00"'),
    description: z.string().optional().describe('Human-readable name for the reminder'),
    invoke_agent: z.boolean().optional().describe('If true, agent will process this message and respond. If false (default), just delivers the message.'),
  },
  async (args) => {
    if (!cronRunner) {
      return {
        content: [{ type: 'text', text: 'Error: Cron system not available' }],
        isError: true,
      };
    }

    try {
      const job = cronRunner.addJob({
        name: args.description || 'Reminder',
        message: args.message,
        at: args.delay,
        deleteAfterRun: true,
        enabled: true,
      });

      return {
        content: [{
          type: 'text',
          text: `Reminder scheduled!\nID: ${job.id}\nRuns at: ${job.nextRunAt || 'unknown'}\nMessage: ${args.message}`,
        }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Failed to schedule reminder: ${err}` }],
        isError: true,
      };
    }
  }
);

export const scheduleRecurringTool = tool(
  'schedule_recurring',
  'Schedule a recurring task at regular intervals. Use for "check X every Y hours" or "send daily report".',
  {
    message: z.string().describe('The task message or prompt'),
    every: z.string().describe('Interval like "30m", "4h", "1d", "1w"'),
    description: z.string().optional().describe('Human-readable name'),
    invoke_agent: z.boolean().optional().describe('If true, agent processes message each time'),
  },
  async (args) => {
    if (!cronRunner) {
      return {
        content: [{ type: 'text', text: 'Error: Cron system not available' }],
        isError: true,
      };
    }

    try {
      const job = cronRunner.addJob({
        name: args.description || 'Recurring Task',
        message: args.message,
        every: args.every,
        enabled: true,
      });

      return {
        content: [{
          type: 'text',
          text: `Recurring task scheduled!\nID: ${job.id}\nInterval: ${args.every}\nNext run: ${job.nextRunAt || 'unknown'}\nMessage: ${args.message}`,
        }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Failed to schedule recurring task: ${err}` }],
        isError: true,
      };
    }
  }
);

export const scheduleCronTool = tool(
  'schedule_cron',
  'Schedule a task using cron expression (5-field format). Use for specific times like "every day at 9am" or "every Monday at 2pm".',
  {
    message: z.string().describe('The task message or prompt'),
    cron: z.string().describe('Cron expression: "minute hour day month weekday". Examples: "0 9 * * *" (9am daily), "0 14 * * 1" (2pm Mondays)'),
    description: z.string().optional().describe('Human-readable name'),
    timezone: z.string().optional().describe('Timezone like "America/New_York"'),
    invoke_agent: z.boolean().optional().describe('If true, agent processes message each time'),
  },
  async (args) => {
    if (!cronRunner) {
      return {
        content: [{ type: 'text', text: 'Error: Cron system not available' }],
        isError: true,
      };
    }

    try {
      const job = cronRunner.addJob({
        name: args.description || 'Scheduled Task',
        message: args.message,
        cron: args.cron,
        timezone: args.timezone,
        enabled: true,
      });

      return {
        content: [{
          type: 'text',
          text: `Task scheduled with cron!\nID: ${job.id}\nExpression: ${args.cron}\nNext run: ${job.nextRunAt || 'unknown'}\nMessage: ${args.message}`,
        }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Failed to schedule cron task: ${err}` }],
        isError: true,
      };
    }
  }
);

export const listRemindersTool = tool(
  'list_reminders',
  'List all scheduled reminders, recurring tasks, and cron jobs.',
  {},
  async () => {
    if (!cronRunner) {
      return {
        content: [{ type: 'text', text: 'Error: Cron system not available' }],
        isError: true,
      };
    }

    const jobs = cronRunner.listJobs();

    if (jobs.length === 0) {
      return {
        content: [{ type: 'text', text: 'No scheduled tasks or reminders.' }],
      };
    }

    const formatted = jobs.map(job => {
      const type = job.cron ? 'cron' : job.every ? 'recurring' : 'one-time';
      const schedule = job.cron || job.every || job.at || 'unknown';
      const status = job.enabled === false ? '❌ disabled' : '✅ enabled';
      const lastRun = job.lastRunAt ? `Last: ${job.lastRunAt}` : 'Not run yet';
      const nextRun = job.nextRunAt ? `Next: ${job.nextRunAt}` : '';

      return `${job.id} - ${job.name} [${type}]
  Schedule: ${schedule}
  Status: ${status}
  ${lastRun}
  ${nextRun}
  Message: ${job.message.slice(0, 100)}${job.message.length > 100 ? '...' : ''}`;
    }).join('\n\n');

    return {
      content: [{ type: 'text', text: `Scheduled Tasks (${jobs.length}):\n\n${formatted}` }],
    };
  }
);

export const cancelReminderTool = tool(
  'cancel_reminder',
  'Cancel a scheduled reminder or recurring task by its ID.',
  {
    job_id: z.string().describe('The job ID to cancel (from list_reminders)'),
  },
  async (args) => {
    if (!cronRunner) {
      return {
        content: [{ type: 'text', text: 'Error: Cron system not available' }],
        isError: true,
      };
    }

    const removed = cronRunner.removeJob(args.job_id);

    if (removed) {
      return {
        content: [{ type: 'text', text: `Successfully cancelled task: ${args.job_id}` }],
      };
    } else {
      return {
        content: [{ type: 'text', text: `Task not found: ${args.job_id}` }],
        isError: true,
      };
    }
  }
);

export const cronTools = [
  scheduleReminderTool,
  scheduleRecurringTool,
  scheduleCronTool,
  listRemindersTool,
  cancelReminderTool,
];
