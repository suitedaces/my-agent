import type { Config } from '../config.js';

// hook event types (matching Claude SDK)
export type HookEvent =
  | 'PreToolUse'
  | 'PostToolUse'
  | 'PostToolUseFailure'
  | 'Notification'
  | 'UserPromptSubmit'
  | 'SessionStart'
  | 'SessionEnd'
  | 'Stop'
  | 'SubagentStart'
  | 'SubagentStop'
  | 'PreCompact'
  | 'PermissionRequest';

export type BaseHookInput = {
  session_id: string;
  transcript_path: string;
  cwd: string;
  permission_mode?: string;
};

export type PreToolUseHookInput = BaseHookInput & {
  hook_event_name: 'PreToolUse';
  tool_name: string;
  tool_input: unknown;
};

export type PostToolUseHookInput = BaseHookInput & {
  hook_event_name: 'PostToolUse';
  tool_name: string;
  tool_input: unknown;
  tool_response: unknown;
};

export type SessionStartHookInput = BaseHookInput & {
  hook_event_name: 'SessionStart';
  source: 'startup' | 'resume' | 'clear' | 'compact';
};

export type SessionEndHookInput = BaseHookInput & {
  hook_event_name: 'SessionEnd';
  reason: string;
};

export type SubagentStartHookInput = BaseHookInput & {
  hook_event_name: 'SubagentStart';
  agent_id: string;
  agent_type: string;
};

export type SubagentStopHookInput = BaseHookInput & {
  hook_event_name: 'SubagentStop';
  stop_hook_active: boolean;
};

export type HookInput =
  | PreToolUseHookInput
  | PostToolUseHookInput
  | SessionStartHookInput
  | SessionEndHookInput
  | SubagentStartHookInput
  | SubagentStopHookInput;

export type HookJSONOutput = {
  continue?: boolean;
  suppressOutput?: boolean;
  stopReason?: string;
  decision?: 'approve' | 'block';
  systemMessage?: string;
  reason?: string;
  hookSpecificOutput?: {
    hookEventName: string;
    permissionDecision?: 'allow' | 'deny' | 'ask';
    permissionDecisionReason?: string;
    updatedInput?: Record<string, unknown>;
    additionalContext?: string;
  };
};

export type HookCallback = (
  input: HookInput,
  toolUseID: string | undefined,
  options: { signal: AbortSignal }
) => Promise<HookJSONOutput>;

export type HookCallbackMatcher = {
  matcher?: string;
  hooks: HookCallback[];
};

// bash command validation hook
const bashValidationHook: HookCallback = async (input) => {
  if (input.hook_event_name !== 'PreToolUse') return { continue: true };

  const toolInput = input.tool_input as { command?: string };
  const command = toolInput.command || '';

  // block dangerous commands
  const dangerous = [
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
  ];

  for (const pattern of dangerous) {
    if (pattern.test(command)) {
      return {
        continue: false,
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: `Blocked dangerous command pattern: ${pattern}`,
        },
      };
    }
  }

  return { continue: true };
};

// session tracking hook
const sessionTrackingHook: HookCallback = async (input) => {
  if (input.hook_event_name === 'SessionStart') {
    console.log(`Session started: ${input.session_id} (source: ${input.source})`);
  } else if (input.hook_event_name === 'SessionEnd') {
    console.log(`Session ended: ${input.session_id} (reason: ${input.reason})`);
  }
  return { continue: true };
};

// default hooks configuration
export function createDefaultHooks(config: Config): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  return {
    PreToolUse: [
      {
        matcher: 'Bash',
        hooks: [bashValidationHook],
      },
    ],
    SessionStart: [
      {
        hooks: [sessionTrackingHook],
      },
    ],
  };
}

// custom hook builder
export function createHook(callback: HookCallback, matcher?: string): HookCallbackMatcher {
  return {
    matcher,
    hooks: [callback],
  };
}

// merge hooks
export function mergeHooks(
  base: Partial<Record<HookEvent, HookCallbackMatcher[]>>,
  override: Partial<Record<HookEvent, HookCallbackMatcher[]>>
): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  const result = { ...base };

  for (const [event, matchers] of Object.entries(override)) {
    const key = event as HookEvent;
    if (result[key]) {
      result[key] = [...result[key]!, ...matchers];
    } else {
      result[key] = matchers;
    }
  }

  return result;
}
