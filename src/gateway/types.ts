export type GatewayStatus = {
  running: boolean;
  startedAt: number | null;
  channels: ChannelStatusInfo[];
  sessions: SessionInfo[];
  calendar: CalendarStatusInfo | null;
};

export type SessionInfo = {
  /** registry key: "channel:chatType:chatId" */
  key: string;
  channel: string;
  chatId: string;
  chatType: string;
  /** our internal ID, used as JSONL filename for message persistence */
  sessionId: string;
  /** SDK's session UUID, passed as `resume` to query() for conversation continuity */
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

export type CalendarStatusInfo = {
  enabled: boolean;
  itemCount: number;
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
  seq?: number;
};

export type RpcMethod =
  | 'status'
  | 'chat.send'
  | 'chat.history'
  | 'chat.answerQuestion'
  | 'sessions.list'
  | 'sessions.get'
  | 'sessions.delete'
  | 'sessions.reset'
  | 'sessions.resume'
  | 'channels.status'
  | 'channels.start'
  | 'channels.stop'
  | 'calendar.list'
  | 'calendar.add'
  | 'calendar.remove'
  | 'calendar.toggle'
  | 'calendar.run'
  | 'calendar.update'
  | 'calendar.export'
  | 'cron.list'
  | 'cron.add'
  | 'cron.remove'
  | 'cron.toggle'
  | 'cron.run'
  | 'goals.list'
  | 'goals.add'
  | 'goals.update'
  | 'goals.delete'
  | 'goals.move'
  | 'skills.list'
  | 'config.get'
  | 'config.set'
  | 'fs.list'
  | 'fs.read'
  | 'fs.readBinary'
  | 'fs.mkdir'
  | 'fs.delete'
  | 'fs.rename'
  | 'fs.watch.start'
  | 'fs.watch.stop'
  | 'agent.run_background'
  | 'agent.background_runs'
  | 'sessions.subscribe'
  | 'sessions.unsubscribe';

export type GatewayEventName =
  | 'agent.stream'
  | 'agent.tool_use'
  | 'agent.tool_result'
  | 'agent.message'
  | 'agent.result'
  | 'agent.error'
  | 'agent.ask_user'
  | 'agent.user_message'
  | 'channel.message'
  | 'channel.status'
  | 'channel.reply'
  | 'calendar.run'
  | 'calendar.result'
  | 'session.update'
  | 'status.update'
  | 'goals.update'
  | 'research.update'
  | 'background.status'
  | 'fs.change'
  | 'agent.status'
  | 'agent.stream_batch'
  | 'session.snapshot';

export type SessionSnapshot = {
  sessionKey: string;
  status: 'idle' | 'thinking' | 'tool_use' | 'responding';
  text: string;
  currentTool: {
    name: string;
    inputJson: string;
    detail: string;
  } | null;
  completedTools: { name: string; detail: string }[];
  pendingApproval: { requestId: string; toolName: string; input: Record<string, unknown>; timestamp: number } | null;
  pendingQuestion: { requestId: string; questions: unknown[]; timestamp: number } | null;
  updatedAt: number;
};

export type GatewayContext = {
  config: import('../config.js').Config;
  sessionRegistry: import('./session-registry.js').SessionRegistry;
  channelManager: import('./channel-manager.js').ChannelManager;
  scheduler: import('../calendar/scheduler.js').SchedulerRunner | null;
  broadcast: (event: WsEvent) => void;
};
