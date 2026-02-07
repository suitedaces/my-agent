import { createTelegramBot, resolveTelegramToken } from './bot.js';
import { sendTelegramMessage, editTelegramMessage, deleteTelegramMessage } from './send.js';
import { registerChannelHandler } from '../../tools/messaging.js';
import type { InboundMessage } from '../types.js';
import type { Bot } from 'grammy';
import { run, type RunnerHandle } from '@grammyjs/runner';

export type TelegramMonitorOptions = {
  botToken?: string;
  tokenFile?: string;
  accountId?: string;
  allowFrom?: string[];
  groupPolicy?: 'open' | 'allowlist' | 'disabled';
  onMessage?: (msg: InboundMessage) => Promise<void>;
  onCommand?: (cmd: string, chatId: string) => Promise<string | void>;
  abortSignal?: AbortSignal;
};

export async function startTelegramMonitor(opts: TelegramMonitorOptions): Promise<() => Promise<void>> {
  const token = resolveTelegramToken(opts.tokenFile);
  const bot: Bot = createTelegramBot({ token });

  // register channel handler for the message tool
  registerChannelHandler('telegram', {
    send: async (target, message, sendOpts) => {
      const replyTo = sendOpts?.replyTo ? Number(sendOpts.replyTo) : undefined;
      return sendTelegramMessage(bot.api, target, message, {
        replyTo,
        media: sendOpts?.media,
      });
    },
    edit: async (messageId, message, chatId) => {
      if (!chatId) throw new Error('chatId required for Telegram edit');
      await editTelegramMessage(bot.api, chatId, messageId, message);
    },
    delete: async (messageId, chatId) => {
      if (!chatId) throw new Error('chatId required for Telegram delete');
      await deleteTelegramMessage(bot.api, chatId, messageId);
    },
  });

  // bot commands
  if (opts.onCommand) {
    const onCmd = opts.onCommand;
    bot.command('new', async (ctx) => {
      const senderId = String(ctx.from?.id || '');
      if (opts.allowFrom && opts.allowFrom.length > 0 && !opts.allowFrom.includes(senderId)) return;
      const chatId = String(ctx.chat.id);
      const reply = await onCmd('new', chatId);
      if (reply) await ctx.reply(reply);
    });
    bot.command('status', async (ctx) => {
      const senderId = String(ctx.from?.id || '');
      if (opts.allowFrom && opts.allowFrom.length > 0 && !opts.allowFrom.includes(senderId)) return;
      const chatId = String(ctx.chat.id);
      const reply = await onCmd('status', chatId);
      if (reply) await ctx.reply(reply);
    });
  }

  // handle incoming text messages
  bot.on('message:text', async (ctx) => {
    if (!opts.onMessage) return;

    const msg = ctx.message;
    const chat = msg.chat;
    const isGroup = chat.type === 'group' || chat.type === 'supergroup';

    // group policy check
    if (isGroup && opts.groupPolicy === 'disabled') return;

    // sender auth check
    const senderId = String(msg.from?.id || '');
    if (opts.allowFrom && opts.allowFrom.length > 0) {
      if (!opts.allowFrom.includes(senderId)) {
        console.log(`[telegram] unauthorized sender: ${senderId} (${msg.from?.first_name || 'unknown'})`);
        return;
      }
    } else if (opts.allowFrom && opts.allowFrom.length === 0) {
      console.log('[telegram] no authorized senders configured, rejecting all messages');
      return;
    }

    const inbound: InboundMessage = {
      id: String(msg.message_id),
      channel: 'telegram',
      accountId: opts.accountId || '',
      chatId: String(chat.id),
      chatType: isGroup ? 'group' : 'dm',
      senderId: String(msg.from?.id || ''),
      senderName: msg.from?.first_name
        ? `${msg.from.first_name}${msg.from.last_name ? ` ${msg.from.last_name}` : ''}`
        : msg.from?.username,
      body: msg.text,
      timestamp: msg.date * 1000,
      replyToId: msg.reply_to_message ? String(msg.reply_to_message.message_id) : undefined,
      raw: msg,
    };

    await opts.onMessage(inbound);
  });

  // start long polling via runner (non-blocking)
  let runner: RunnerHandle;
  try {
    runner = run(bot);
    console.log('[telegram] monitor started');
  } catch (err) {
    console.error('[telegram] failed to start:', err);
    throw err;
  }

  // return stop function
  return async () => {
    if (runner.isRunning()) {
      runner.stop();
    }
  };
}
