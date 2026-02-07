import type { Config } from '../config.js';

export type Tier = 'auto-allow' | 'notify' | 'require-approval';

const DESTRUCTIVE_PATTERNS = [
  /rm\s+-rf\s+\//,
  /rm\s+-rf\s+~/,
  /rm\s+-rf\s+\.\.\//,
  /mkfs\./,
  /dd\s+if=/,
  />\s*\/dev\/sd/,
  /curl\s+.*\|\s*(ba)?sh/,
  /wget\s+.*\|\s*(ba)?sh/,
  /chmod\s+777/,
  /:()\{\s*:\|:&\s*\};:/,
  /shutdown|reboot|halt/,
  /launchctl\s+unload/,
  /defaults\s+delete/,
  /find\s+\/\s+-delete/,
  />\s*\/dev\/null\s*2>&1\s*&/,
];

function classifyBashCommand(command: string): Tier {
  for (const pattern of DESTRUCTIVE_PATTERNS) {
    if (pattern.test(command)) return 'require-approval';
  }
  return 'auto-allow';
}

export function classifyToolCall(
  toolName: string,
  input: Record<string, unknown>,
  _context?: { isCron?: boolean }
): Tier {
  if (toolName === 'Bash' || toolName === 'bash') {
    const command = (input.command as string) || '';
    return classifyBashCommand(command);
  }

  if (toolName === 'mcp__my-agent__schedule_recurring' ||
      toolName === 'mcp__my-agent__schedule_cron') {
    return 'notify';
  }

  if (toolName === 'mcp__my-agent__message') {
    const action = input.action as string;
    if (action === 'send') return 'notify';
  }

  return 'auto-allow';
}
