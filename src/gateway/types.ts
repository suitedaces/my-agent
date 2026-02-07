export type GatewayStatus = {
  running: boolean;
  startedAt: number | null;
  channels: ChannelStatusInfo[];
  sessions: SessionInfo[];
  heartbeat: HeartbeatStatusInfo | null;
  cron: CronStatusInfo | null;
};

export type SessionInfo = {
  key: string;
  channel: string;
  chatId: string;
  chatType: string;
  sessionId: string;
  sdkSessionId?: string;
  messageCount: number;
  lastMessageAt: number;
  activeRun: boolean;
};

export type ChannelStatusInfo = {
  channel: string;
  accountId: string;
  running: boolean;
  connected: boolean;
  lastError: string | null;
};

export type HeartbeatStatusInfo = {
  enabled: boolean;
  interval: string;
  lastRunAt: number | null;
  nextDueAt: number | null;
  lastStatus: string | null;
};

export type CronStatusInfo = {
  enabled: boolean;
  jobCount: number;
};

export type WsMessage = {
  id?: string;
  method: string;
  params?: Record<string, unknown>;
};

export type WsResponse = {
  id?: string;
  result?: unknown;
  error?: string;
};

export type WsEvent = {
  event: string;
  data: unknown;
};

export type RpcMethod =
  | 'status'
  | 'chat.send'
  | 'chat.history'
  | 'sessions.list'
  | 'sessions.get'
  | 'sessions.delete'
  | 'channels.status'
  | 'channels.start'
  | 'channels.stop'
  | 'cron.list'
  | 'cron.add'
  | 'cron.remove'
  | 'cron.toggle'
  | 'cron.run'
  | 'heartbeat.status'
  | 'heartbeat.run'
  | 'skills.list'
  | 'config.get'
  | 'config.set'
  | 'fs.list';

export type GatewayEventName =
  | 'agent.stream'
  | 'agent.tool_use'
  | 'agent.tool_result'
  | 'agent.message'
  | 'agent.result'
  | 'agent.error'
  | 'channel.message'
  | 'channel.status'
  | 'channel.reply'
  | 'heartbeat.run'
  | 'heartbeat.result'
  | 'cron.run'
  | 'cron.result'
  | 'session.update'
  | 'status.update';

export type GatewayContext = {
  config: import('../config.js').Config;
  sessionRegistry: import('./session-registry.js').SessionRegistry;
  channelManager: import('./channel-manager.js').ChannelManager;
  heartbeatRunner: import('../heartbeat/runner.js').HeartbeatRunner | null;
  cronRunner: import('../cron/scheduler.js').CronRunner | null;
  broadcast: (event: WsEvent) => void;
};
