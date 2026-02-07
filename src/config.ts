import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';

export type SandboxSettings = {
  enabled?: boolean;
  autoAllowBashIfSandboxed?: boolean;
  excludedCommands?: string[];
  allowUnsandboxedCommands?: boolean;
  network?: {
    allowLocalBinding?: boolean;
    allowUnixSockets?: string[];
  };
};

export type AgentDefinition = {
  description: string;
  tools?: string[];
  prompt: string;
  model?: 'sonnet' | 'opus' | 'haiku' | 'inherit';
};

export type HeartbeatConfig = {
  enabled?: boolean;
  every?: string;
  prompt?: string;
  target?: 'last' | 'none' | string;
  ackMaxChars?: number;
  activeHours?: {
    start?: string;
    end?: string;
    timezone?: string;
  };
  session?: string;
  model?: string;
  includeReasoning?: boolean;
};

export type CronConfig = {
  enabled?: boolean;
  jobsFile?: string;
};

export type WhatsAppChannelConfig = {
  enabled?: boolean;
  authDir?: string;
  accountId?: string;
  dmPolicy?: 'open' | 'allowlist';
  groupPolicy?: 'open' | 'allowlist' | 'disabled';
  allowFrom?: string[];
};

export type TelegramChannelConfig = {
  enabled?: boolean;
  botToken?: string;
  tokenFile?: string;
  accountId?: string;
  dmPolicy?: 'open' | 'allowlist';
  groupPolicy?: 'open' | 'allowlist' | 'disabled';
  allowFrom?: (string | number)[];
};

export type ChannelsConfig = {
  whatsapp?: WhatsAppChannelConfig;
  telegram?: TelegramChannelConfig;
};

export type GatewayConfig = {
  port?: number;
  host?: string;
  enabled?: boolean;
};

export type BrowserConfig = {
  enabled?: boolean;
  executablePath?: string;
  cdpPort?: number;
  profileDir?: string;
  headless?: boolean;
};

export type Config = {
  model: string;
  systemPromptMode: 'full' | 'minimal' | 'none';
  permissionMode: PermissionMode;
  skills: {
    enabled: string[];
    disabled: string[];
    dirs: string[];
  };
  agents: Record<string, AgentDefinition>;
  sandbox: SandboxSettings;
  heartbeat?: HeartbeatConfig;
  cron?: CronConfig;
  channels?: ChannelsConfig;
  gateway?: GatewayConfig;
  browser?: BrowserConfig;
  sessionDir: string;
  cwd: string;
};

const DEFAULT_CONFIG: Config = {
  model: 'claude-sonnet-4-5-20250929',
  systemPromptMode: 'full',
  permissionMode: 'default',
  skills: {
    enabled: [],
    disabled: [],
    dirs: [
      join(process.cwd(), 'skills'),
      join(homedir(), '.my-agent', 'skills'),
    ],
  },
  agents: {},
  sandbox: {
    enabled: false,
    autoAllowBashIfSandboxed: false,
  },
  sessionDir: join(homedir(), '.my-agent', 'sessions'),
  cwd: process.cwd(),
};

export async function loadConfig(configPath?: string): Promise<Config> {
  const paths = [
    configPath,
    join(process.cwd(), 'my-agent.config.json'),
    join(homedir(), '.my-agent', 'config.json'),
  ].filter(Boolean) as string[];

  for (const p of paths) {
    if (existsSync(p)) {
      try {
        const content = readFileSync(p, 'utf-8');
        const userConfig = JSON.parse(content);
        return mergeConfig(DEFAULT_CONFIG, userConfig);
      } catch {
        // ignore parse errors, use defaults
      }
    }
  }

  return DEFAULT_CONFIG;
}

function mergeConfig(base: Config, override: Partial<Config>): Config {
  return {
    ...base,
    ...override,
    skills: {
      ...base.skills,
      ...override.skills,
    },
    sandbox: {
      ...base.sandbox,
      ...override.sandbox,
    },
    agents: {
      ...base.agents,
      ...override.agents,
    },
  };
}

export function getConfigValue<K extends keyof Config>(config: Config, key: K): Config[K] {
  return config[key];
}
