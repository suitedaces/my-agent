import type { Config } from '../config.js';
import type { InboundMessage, ChannelStatus } from '../channels/types.js';
import { startWhatsAppMonitor } from '../channels/whatsapp/monitor.js';
import { startTelegramMonitor } from '../channels/telegram/monitor.js';

export type ChannelManagerOptions = {
  config: Config;
  onMessage: (msg: InboundMessage) => Promise<void>;
  onCommand?: (channel: string, cmd: string, chatId: string) => Promise<string | void>;
  onStatus?: (status: ChannelStatus) => void;
};

type ChannelState = {
  id: string;
  running: boolean;
  connected: boolean;
  accountId: string;
  lastError: string | null;
  stop: (() => Promise<void>) | null;
};

export class ChannelManager {
  private config: Config;
  private onMessage: (msg: InboundMessage) => Promise<void>;
  private onStatus?: (status: ChannelStatus) => void;
  private channels = new Map<string, ChannelState>();

  private onCommand?: (channel: string, cmd: string, chatId: string) => Promise<string | void>;

  constructor(opts: ChannelManagerOptions) {
    this.config = opts.config;
    this.onMessage = opts.onMessage;
    this.onCommand = opts.onCommand;
    this.onStatus = opts.onStatus;
  }

  async startChannel(channelId: string): Promise<void> {
    if (this.channels.get(channelId)?.running) return;

    const state: ChannelState = {
      id: channelId,
      running: false,
      connected: false,
      accountId: '',
      lastError: null,
      stop: null,
    };
    this.channels.set(channelId, state);

    try {
      if (channelId === 'whatsapp') {
        await this.startWhatsApp(state);
      } else if (channelId === 'telegram') {
        await this.startTelegram(state);
      } else {
        throw new Error(`Unknown channel: ${channelId}`);
      }
    } catch (err) {
      state.lastError = err instanceof Error ? err.message : String(err);
      state.running = false;
      this.emitStatus(state);
    }
  }

  private async startWhatsApp(state: ChannelState): Promise<void> {
    const waConfig = this.config.channels?.whatsapp;
    if (!waConfig?.enabled) {
      state.lastError = 'WhatsApp not enabled in config';
      return;
    }

    state.accountId = waConfig.accountId || '';
    state.running = true;
    this.emitStatus(state);

    const stop = await startWhatsAppMonitor({
      authDir: waConfig.authDir,
      accountId: waConfig.accountId,
      allowFrom: waConfig.allowFrom,
      groupPolicy: waConfig.groupPolicy,
      onMessage: async (raw) => {
        const msg = raw as InboundMessage;
        state.connected = true;
        state.lastError = null;
        await this.onMessage(msg);
      },
    });

    state.connected = true;
    state.stop = stop;
    this.emitStatus(state);
  }

  private async startTelegram(state: ChannelState): Promise<void> {
    const tgConfig = this.config.channels?.telegram;
    if (!tgConfig?.enabled) {
      state.lastError = 'Telegram not enabled in config';
      return;
    }

    state.accountId = tgConfig.accountId || '';
    state.running = true;
    this.emitStatus(state);

    const stop = await startTelegramMonitor({
      tokenFile: tgConfig.tokenFile,
      accountId: tgConfig.accountId,
      allowFrom: tgConfig.allowFrom,
      groupPolicy: tgConfig.groupPolicy,
      onMessage: async (raw) => {
        const msg = raw as InboundMessage;
        state.connected = true;
        state.lastError = null;
        await this.onMessage(msg);
      },
      onCommand: this.onCommand
        ? async (cmd, chatId) => this.onCommand!('telegram', cmd, chatId)
        : undefined,
    });

    state.connected = true;
    state.stop = stop;
    this.emitStatus(state);
  }

  async stopChannel(channelId: string): Promise<void> {
    const state = this.channels.get(channelId);
    if (!state) return;

    if (state.stop) {
      try { await state.stop(); } catch {}
    }

    state.running = false;
    state.connected = false;
    state.stop = null;
    this.emitStatus(state);
  }

  async startAll(): Promise<void> {
    const promises: Promise<void>[] = [];

    if (this.config.channels?.whatsapp?.enabled) {
      promises.push(this.startChannel('whatsapp'));
    }
    if (this.config.channels?.telegram?.enabled) {
      promises.push(this.startChannel('telegram'));
    }

    await Promise.allSettled(promises);
  }

  async stopAll(): Promise<void> {
    const promises = Array.from(this.channels.keys()).map(id => this.stopChannel(id));
    await Promise.allSettled(promises);
  }

  getStatuses(): ChannelStatus[] {
    return Array.from(this.channels.values()).map(s => ({
      channel: s.id,
      accountId: s.accountId,
      running: s.running,
      connected: s.connected,
      lastConnectedAt: s.connected ? Date.now() : null,
      lastError: s.lastError,
    }));
  }

  private emitStatus(state: ChannelState): void {
    this.onStatus?.({
      channel: state.id,
      accountId: state.accountId,
      running: state.running,
      connected: state.connected,
      lastConnectedAt: state.connected ? Date.now() : null,
      lastError: state.lastError,
    });
  }
}
