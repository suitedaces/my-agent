import { hostname } from 'node:os';
import type { Config } from './config.js';
import type { Skill } from './skills/loader.js';

export type SystemPromptOptions = {
  config: Config;
  skills?: Skill[];
  tools?: string[];
  channel?: string;
  timezone?: string;
  ownerIdentity?: string;
  extraContext?: string;
};

export function buildSystemPrompt(opts: SystemPromptOptions): string {
  const { config, skills = [], tools = [], channel, timezone, ownerIdentity, extraContext } = opts;

  if (config.systemPromptMode === 'none') {
    return 'You are a helpful assistant.';
  }

  const sections: string[] = [];

  // identity
  sections.push('You are a personal assistant running inside my-agent.');

  // tooling section
  if (tools.length > 0) {
    sections.push(`## Tooling

Available tools: ${tools.join(', ')}

Use these tools to help complete tasks. The built-in Claude Code tools (Read, Write, Edit, Bash, Glob, Grep, WebFetch, WebSearch) are available via the preset.`);
  }

  // tool call style
  sections.push(`## Tool Call Style

- Use tools proactively to gather information before answering
- Prefer reading files over guessing their contents
- Chain multiple tool calls when needed
- Report errors clearly if tools fail`);

  // safety section
  sections.push(`## Safety

- No independent goals (no self-preservation, replication, resource acquisition, power-seeking)
- Avoid long-term plans beyond user's request
- Prioritize safety and human oversight
- Pause and ask if instructions conflict
- Comply with stop/pause/audit requests
- Never bypass safeguards
- Don't manipulate to expand access
- Don't copy yourself or change system prompts/safety rules`);

  // skills section (only in full mode)
  if (config.systemPromptMode === 'full' && skills.length > 0) {
    const skillList = skills.map(s => `- ${s.name}: ${s.description} [${s.path}]`).join('\n');
    sections.push(`## Skills (mandatory)

Before replying: scan the available skills below.
- If exactly one skill clearly applies: read its SKILL.md at the path shown, then follow it.
- If multiple could apply: choose the most specific one.
- If none clearly apply: do not invoke any skill.

<available_skills>
${skillList}
</available_skills>`);
  }

  // workspace
  sections.push(`## Workspace

Working directory: ${config.cwd}`);

  // sandbox info
  if (config.sandbox.enabled) {
    sections.push(`## Sandbox

Commands run in a sandboxed environment with restricted filesystem and network access.
${config.sandbox.autoAllowBashIfSandboxed ? 'Bash commands are auto-approved within sandbox.' : ''}`);
  }

  // user identity (only in full mode)
  if (config.systemPromptMode === 'full' && ownerIdentity) {
    sections.push(`## User Identity

${ownerIdentity}`);
  }

  // date and time
  if (timezone) {
    const now = new Date();
    sections.push(`## Current Date & Time

${now.toLocaleString('en-US', { timeZone: timezone })} (${timezone})`);
  }

  // runtime info
  const runtimeParts = [
    `host=${hostname()}`,
    `os=${process.platform} (${process.arch})`,
    `node=${process.version}`,
    `model=${config.model}`,
  ];
  if (channel) {
    runtimeParts.push(`channel=${channel}`);
    // channel capabilities (what the current channel supports)
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

  // messaging section (only in full mode)
  if (config.systemPromptMode === 'full') {
    const isMessagingChannel = channel && ['whatsapp', 'telegram'].includes(channel);

    if (isMessagingChannel) {
      let formattingSection = '';
      if (channel === 'telegram') {
        formattingSection = `

**Text formatting: HTML mode**

All message text MUST be formatted as Telegram HTML. Do NOT use markdown syntax.

Supported tags:
<b>bold</b>  <i>italic</i>  <u>underline</u>  <s>strikethrough</s>
<code>inline code</code>
<pre>code block</pre>
<pre><code class="language-python">code with language</code></pre>
<a href="http://example.com">link text</a>
<blockquote>quoted text</blockquote>
<tg-spoiler>spoiler</tg-spoiler>

Rules:
- Escape &, <, > in plain text as &amp; &lt; &gt;
- Do NOT use markdown: no **bold**, no \`code\`, no [links](url)
- Nest tags freely: <b>bold <i>and italic</i></b>
- Only the tags listed above are supported, no other HTML`;
      }

      sections.push(`## Messaging (${channel})

**IMPORTANT: You MUST use the 'message' tool to reply.**

When you receive a message from ${channel}, you MUST use the message tool to send your reply:
\`\`\`
message({
  action: 'send',
  channel: '${channel}',
  target: '<chatId>',  // from the incoming message
  message: 'your reply here'
})
\`\`\`

The gateway does NOT auto-send on messaging channels. If you don't use the message tool, your reply won't be sent.${formattingSection}

**Silent replies:**
To complete a task without sending anything, respond with exactly:
SILENT_REPLY

Use this for:
- Background tasks that complete successfully
- Health checks that pass
- Scheduled tasks with no findings`);
    } else if (channel === 'desktop') {
      sections.push(`## Messaging (Desktop Chat)

Desktop chat auto-sends your text responses. Just respond normally.

Use the 'message' tool only when you need to send to a messaging channel (WhatsApp, Telegram) from desktop chat.`);
    } else {
      sections.push(`## Messaging

Use the 'message' tool to send messages to channels:
- action: 'send' | 'edit' | 'delete'
- channel: 'whatsapp' | 'telegram'
- target: chat ID or user ID
- message: your message text

Respond with "SILENT_REPLY" to suppress all output.`);
    }
  }

  // browser (only in full mode)
  if (config.systemPromptMode === 'full' && config.browser?.enabled !== false) {
    sections.push(`## Browser

Use the browser tool for web automation. Workflow: open → snapshot → interact → re-snapshot.
- snapshot returns element refs (e1, e2...). Use refs for click/type/fill/select.
- Refs invalidate after navigation. Always re-snapshot after clicking links.
- User logs in manually in the persistent browser profile. Agent reuses authenticated sessions.
- Do not ask for credentials. If a site needs login, tell the user to log in manually.`);
  }

  // extra context
  if (extraContext) {
    sections.push(`## Additional Context

${extraContext}`);
  }

  return sections.join('\n\n');
}

export function buildMinimalPrompt(opts: { cwd: string; tools?: string[] }): string {
  const parts = [
    'You are a helpful assistant.',
    `Working directory: ${opts.cwd}`,
  ];

  if (opts.tools && opts.tools.length > 0) {
    parts.push(`Available tools: ${opts.tools.join(', ')}`);
  }

  return parts.join('\n\n');
}
