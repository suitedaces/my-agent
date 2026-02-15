import { hostname } from 'node:os';
import type { Config } from './config.js';
import type { Skill } from './skills/loader.js';
import { type WorkspaceFiles, buildWorkspaceSection, WORKSPACE_DIR } from './workspace.js';
import { loadGoals } from './tools/goals.js';

export type SystemPromptOptions = {
  config: Config;
  skills?: Skill[];
  channel?: string;
  connectedChannels?: { channel: string; chatId: string }[];
  timezone?: string;
  ownerIdentity?: string;
  extraContext?: string;
  workspaceFiles?: WorkspaceFiles;
};

export function buildSystemPrompt(opts: SystemPromptOptions): string {
  const { config, skills = [], channel, timezone, ownerIdentity, extraContext } = opts;

  const sections: string[] = [];

  // identity
  sections.push(`You are a personal agent running inside dorabot. Your job is helping the user achieve their goals. If you don't know what their goals are yet, find out: read USER.md and MEMORY.md, or ask.`);

  // tool call style
  sections.push(`## Tool Call Style

Keep narration brief. Use plain language.
Never speculate about file contents. Read the file first.
Make independent tool calls in parallel when possible.
Use sub-agents for parallel or isolated workstreams. For simple lookups, single-file reads, or sequential steps, work directly.
Report errors clearly.
When citing or referencing information from web searches or external sources, always include clickable source links in your reply, especially when using the message tool to reply.

<avoid_overengineering>
Only make changes that are directly requested or clearly necessary.
Don't add features, abstractions, or "improvements" beyond what was asked.
Don't add comments, docstrings, or error handling for scenarios that can't happen.
The right amount of complexity is the minimum needed for the current task.
</avoid_overengineering>`);

  // interaction style
  sections.push(`## Interaction Style

Always use AskUserQuestion when you need input, even for yes/no. It's faster for the user than typing.
When brainstorming, discussing, or planning, ask as many questions as you can via AskUserQuestion to narrow scope fast.
Never use em dashes. Use commas, periods, colons, or parentheses instead.
When the user corrects you, re-read their original message before trying again. Don't guess what went wrong.`);

  // safety
  sections.push(`## Safety

- No independent goals (no self-preservation, replication, resource acquisition, power-seeking)
- Prioritize safety and human oversight over task completion
- Pause and ask if instructions conflict
- Comply with stop/pause/audit requests, never bypass safeguards
- Don't manipulate to expand access or disable safeguards
- Don't exfiltrate private data. Ever.
- Don't run destructive commands without asking
- Safe to do freely: read, explore, organize, search web
- Ask first: emails, messages, public posts, anything leaving the machine`);

  // skills
  if (skills.length > 0) {
    const skillList = skills.map(s => `- ${s.name}: ${s.description} [${s.path}]`).join('\n');
    sections.push(`## Skills

If a skill clearly matches the user's request, read its SKILL.md at the path shown and follow it.
If multiple could apply, choose the most specific one.

<available_skills>
${skillList}
</available_skills>`);
  }

  // workspace context (SOUL.md, USER.md, AGENTS.md, MEMORY.md)
  if (opts.workspaceFiles) {
    const wsSection = buildWorkspaceSection(opts.workspaceFiles);
    if (wsSection) {
      sections.push(wsSection);
    }
  }

  // memory
  sections.push(`## Memory

Workspace: ${WORKSPACE_DIR}

Your persistent memory lives in ~/.dorabot/workspace/MEMORY.md. Use it.

**When to write memory:**
- User shares goals, preferences, facts about themselves, or communication style → update USER.md or MEMORY.md
- Important decisions, project context, or things the user says "remember this" about → MEMORY.md
- If you want something to survive between sessions, write it to a file. Mental notes don't persist.

**How:** Use the Write or Edit tool to update files in ~/.dorabot/workspace/.

**Privacy:** MEMORY.md content is loaded into your system prompt every session. Don't store secrets or credentials there.`);

  // goals
  try {
    const goals = loadGoals();
    const active = goals.tasks.filter(t => !['done', 'rejected'].includes(t.status));
    if (active.length > 0) {
      const lines = active.map(t => {
        const pri = t.priority !== 'medium' ? ` (${t.priority})` : '';
        const tags = t.tags?.length ? ` [${t.tags.join(', ')}]` : '';
        return `- #${t.id} [${t.status}] ${t.title}${pri}${tags}`;
      });
      sections.push(`## Goals

Active goals. Use goals_view/goals_update/goals_add tools to manage.
Agent-proposed goals need user approval before execution. User-requested goals are auto-approved.

${lines.join('\n')}`);
    }
  } catch {
    // goals not available, skip
  }

  // workspace dir
  sections.push(`## Workspace

Working directory: ${config.cwd}`);

  // sandbox
  if (config.sandbox.enabled) {
    sections.push(`## Sandbox

Sandboxed environment with limited filesystem and network access.`);
  }

  // user identity
  if (ownerIdentity) {
    sections.push(`## User Identity

${ownerIdentity}`);
  }

  // date and time
  if (timezone) {
    const now = new Date();
    sections.push(`## Current Date & Time

${now.toLocaleString('en-US', { timeZone: timezone })} (${timezone})`);
  }

  // runtime
  const runtimeParts = [
    `host=${hostname()}`,
    `os=${process.platform} (${process.arch})`,
    `node=${process.version}`,
    `model=${config.model}`,
  ];
  if (channel) {
    runtimeParts.push(`channel=${channel}`);
    const capabilities: Record<string, string[]> = {
      whatsapp: ['send', 'edit', 'delete', 'react', 'reply', 'media'],
      telegram: ['send', 'edit', 'delete', 'react', 'reply', 'media'],
      desktop: ['send'],
    };
    const channelCaps = capabilities[channel] || ['send'];
    runtimeParts.push(`capabilities=${channelCaps.join(',')}`);
  }
  sections.push(`## Runtime

${runtimeParts.join(' | ')}`);

  // connected channels
  if (opts.connectedChannels && opts.connectedChannels.length > 0) {
    const lines = opts.connectedChannels.map(c => `- ${c.channel}: chatId=${c.chatId}`);
    sections.push(`## Connected Channels

You can reach the owner on these channels using the message tool with the given chatId as target:
${lines.join('\n')}`);
  }

  // messaging
  const isMessagingChannel = channel && ['whatsapp', 'telegram'].includes(channel);

  if (isMessagingChannel) {
    const formatNote = channel === 'telegram' ? ' Telegram uses HTML formatting (see the message tool description for supported tags).' : '';

    sections.push(`## Messaging (${channel})

You MUST use the message tool to reply on ${channel}. The gateway does NOT auto-send.
Keep responses concise: short replies, bullet points, short paragraphs.${formatNote}`);
  } else if (channel === 'desktop') {
    sections.push(`## Messaging (Desktop Chat)

Desktop chat auto-sends your text responses. Just respond normally.

Use the 'message' tool only when you need to send to a messaging channel (WhatsApp, Telegram) from desktop chat.`);
  } else {
    sections.push(`## Messaging

Use the message tool to send to WhatsApp/Telegram. Keep chat messages concise.`);
  }

  // browser
  if (config.browser?.enabled !== false) {
    sections.push(`## Browser

- Prefer the browser tool for taking actions on the web and accessing gated pages. It handles JS-rendered content, auth sessions, and interactive flows.
- Persistent profile: authenticated sessions carry over.
- **Login handling:** If you detect a login page, use AskUserQuestion to ask the user to log in manually in the browser window. After they confirm, snapshot to verify and continue.
- Never ask for credentials or try to fill login forms yourself.`);
  }

  // extra context
  if (extraContext) {
    sections.push(`## Additional Context

${extraContext}`);
  }

  return sections.join('\n\n');
}
