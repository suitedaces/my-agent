export type ChatType = 'dm' | 'group' | 'channel';

export type InboundMessage = {
  id: string;
  channel: string;
  accountId: string;
  chatId: string;
  chatType: ChatType;
  senderId: string;
  senderName?: string;
  body: string;
  timestamp: number;
  replyToId?: string;
  replyToBody?: string;
  mediaPath?: string;
  mediaType?: string;
  raw?: unknown;
};

export type SendOptions = {
  media?: string;
  replyTo?: string;
  silent?: boolean;
};

export type OutboundResult = {
  id: string;
  chatId: string;
};

export type ChannelHandler = {
  send: (target: string, message: string, opts?: SendOptions) => Promise<OutboundResult>;
  edit: (messageId: string, message: string, chatId?: string) => Promise<void>;
  delete: (messageId: string, chatId?: string) => Promise<void>;
};

export type ChannelStatus = {
  channel: string;
  accountId: string;
  running: boolean;
  connected: boolean;
  lastConnectedAt: number | null;
  lastError: string | null;
};

export type ChannelConfig = {
  enabled?: boolean;
  dmPolicy?: 'open' | 'allowlist';
  allowFrom?: string[];
};

export type ChannelEventMap = {
  message: InboundMessage;
  status: ChannelStatus;
  error: { channel: string; error: Error };
};
