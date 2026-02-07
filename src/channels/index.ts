export type { ChannelHandler, ChannelStatus, ChannelConfig, ChannelEventMap, InboundMessage, SendOptions, OutboundResult, ChatType } from './types.js';
export { registerChannelHandler, getChannelHandler } from '../tools/messaging.js';

import type { ChannelStatus } from './types.js';

const statuses = new Map<string, ChannelStatus>();

export function updateChannelStatus(status: ChannelStatus): void {
  statuses.set(status.channel, status);
}

export function getAllChannelStatuses(): ChannelStatus[] {
  return Array.from(statuses.values());
}

export function getChannelStatus(channel: string): ChannelStatus | undefined {
  return statuses.get(channel);
}
