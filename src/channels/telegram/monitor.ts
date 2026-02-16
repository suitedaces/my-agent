import { createTelegramBot, resolveTelegramToken } from './bot.js';
import { sendTelegramMessage, editTelegramMessage, deleteTelegramMessage } from './send.js';
import { downloadTelegramFile } from './media.js';
import { registerChannelHandler } from '../../tools/messaging.js';
import type { InboundMessage } from '../types.js';
import { InlineKeyboard, type Bot } from 'grammy';
import { run, type RunnerHandle } from '@grammyjs/runner';

export type ApprovalRequest = {
  requestId: string;
  toolName: string;
  input: Record<string, unknown>;
};

export type QuestionRequest = {
  requestId: string;
  chatId: string;
  question: string;
  options: { label: string; description?: string }[];
};

export type TelegramMonitorOptions = {
  botToken?: string;
  tokenFile?: string;
  accountId?: string;
  allowFrom?: string[];
  groupPolicy?: 'open' | 'allowlist' | 'disabled';
  onMessage?: (msg: InboundMessage) => Promise<void>;
  onCommand?: (cmd: string, chatId: string) => Promise<string | void>;
  onApprovalResponse?: (requestId: string, approved: boolean, reason?: string) => void;
  onQuestionResponse?: (requestId: string, selectedIndex: number, label: string) => void;
  abortSignal?: AbortSignal;
};

export type TelegramMonitorHandle = {
  stop: () => Promise<void>;
  sendApprovalRequest: (req: ApprovalRequest) => Promise<void>;
  sendQuestion: (req: QuestionRequest) => Promise<void>;
};

export async function startTelegramMonitor(opts: TelegramMonitorOptions): Promise<TelegramMonitorHandle> {
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
    typing: async (chatId) => {
      try {
        await bot.api.sendChatAction(Number(chatId), 'typing');
      } catch {}
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

  // handle callback queries (approvals + questions)
  bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data;
    const sep = data.indexOf(':');
    if (sep < 0) return;

    const action = data.slice(0, sep);

    // question response: q:{requestId}:{optionIndex}
    if (action === 'q') {
      const rest = data.slice(sep + 1);
      const sep2 = rest.indexOf(':');
      if (sep2 < 0) return;
      const requestId = rest.slice(0, sep2);
      const optionIndex = parseInt(rest.slice(sep2 + 1), 10);
      const buttonText = ctx.callbackQuery.data;
      // find the label from the inline keyboard
      const label = (ctx.callbackQuery.message as any)?.reply_markup?.inline_keyboard
        ?.flat()?.find((b: any) => b.callback_data === buttonText)?.text || `Option ${optionIndex + 1}`;
      opts.onQuestionResponse?.(requestId, optionIndex, label);
      try {
        await ctx.editMessageText(
          `${ctx.callbackQuery.message?.text || ''}\n\n\u2705 ${escapeHtml(label)}`,
          { parse_mode: 'HTML' },
        );
      } catch {}
      await ctx.answerCallbackQuery(label);
      return;
    }

    // approval response
    const requestId = data.slice(sep + 1);
    if (action !== 'approve' && action !== 'deny') return;

    const approved = action === 'approve';
    opts.onApprovalResponse?.(requestId, approved, approved ? undefined : 'denied via telegram');

    try {
      const label = approved ? '\u2705 Approved' : '\u274c Denied';
      await ctx.editMessageText(`${ctx.callbackQuery.message?.text || ''}\n\n${label}`, { parse_mode: 'HTML' });
    } catch {}
    await ctx.answerCallbackQuery(approved ? 'Approved' : 'Denied');
  });

  // shared auth + group check, returns null if message should be ignored
  function checkAccess(ctx: { message?: { chat: { type: string; id: number }; from?: { id: number; first_name?: string; last_name?: string; username?: string } } }) {
    if (!opts.onMessage) return null;
    const msg = ctx.message;
    if (!msg) return null;
    const chat = msg.chat;
    const isGroup = chat.type === 'group' || chat.type === 'supergroup';
    if (isGroup && opts.groupPolicy === 'disabled') return null;
    const senderId = String(msg.from?.id || '');
    if (opts.allowFrom && opts.allowFrom.length > 0) {
      if (!opts.allowFrom.includes(senderId)) {
        console.log(`[telegram] unauthorized sender: ${senderId} (${msg.from?.first_name || 'unknown'})`);
        return null;
      }
    }
    return { chat, isGroup, senderId };
  }

  function buildInbound(msg: any, isGroup: boolean, body: string): InboundMessage {
    const replyMsg = msg.reply_to_message;
    const replyToBody = replyMsg
      ? (replyMsg.text || replyMsg.caption || undefined)
      : undefined;
    return {
      id: String(msg.message_id),
      channel: 'telegram',
      accountId: opts.accountId || '',
      chatId: String(msg.chat.id),
      chatType: isGroup ? 'group' : 'dm',
      senderId: String(msg.from?.id || ''),
      senderName: msg.from?.first_name
        ? `${msg.from.first_name}${msg.from.last_name ? ` ${msg.from.last_name}` : ''}`
        : msg.from?.username,
      body,
      timestamp: msg.date * 1000,
      replyToId: msg.reply_to_message ? String(msg.reply_to_message.message_id) : undefined,
      replyToBody,
      raw: msg,
    };
  }

  // handle incoming text messages
  bot.on('message:text', async (ctx) => {
    const access = checkAccess(ctx);
    if (!access) return;

    const inbound = buildInbound(ctx.message, access.isGroup, ctx.message.text);
    try {
      await opts.onMessage!(inbound);
    } catch (err) {
      console.error('[telegram] onMessage error:', err);
    }
  });

  // handle incoming media messages (photo, video, audio, document, voice, animation, video_note)
  for (const mediaType of ['photo', 'video', 'audio', 'document', 'voice', 'animation', 'video_note'] as const) {
    bot.on(`message:${mediaType}`, async (ctx) => {
      const access = checkAccess(ctx);
      if (!access) return;

      const msg = ctx.message as any;
      const caption = msg.caption || '';

      // resolve file_id based on media type
      let fileId: string;
      let fallbackExt: string;
      let fallbackMime: string | undefined;

      if (mediaType === 'photo') {
        // photos come as array of sizes — pick the largest
        const sizes = msg.photo;
        fileId = sizes[sizes.length - 1].file_id;
        fallbackExt = 'jpg';
        fallbackMime = 'image/jpeg';
      } else if (mediaType === 'voice') {
        fileId = msg.voice.file_id;
        fallbackExt = 'ogg';
        fallbackMime = msg.voice.mime_type;
      } else if (mediaType === 'video_note') {
        fileId = msg.video_note.file_id;
        fallbackExt = 'mp4';
        fallbackMime = 'video/mp4';
      } else if (mediaType === 'animation') {
        fileId = msg.animation.file_id;
        fallbackExt = 'mp4';
        fallbackMime = msg.animation.mime_type;
      } else {
        // video, audio, document — all have file_id and optional mime_type
        const media = msg[mediaType];
        fileId = media.file_id;
        fallbackExt = mediaType === 'video' ? 'mp4' : mediaType === 'audio' ? 'mp3' : 'bin';
        fallbackMime = media.mime_type;
      }

      try {
        const { path, mimeType } = await downloadTelegramFile(bot.api, fileId, fallbackExt, fallbackMime);
        console.log(`[telegram] downloaded ${mediaType}: ${path} (${mimeType})`);

        const inbound = buildInbound(msg, access.isGroup, caption);
        inbound.mediaPath = path;
        inbound.mediaType = mimeType;
        try {
          await opts.onMessage!(inbound);
        } catch (err) {
          console.error(`[telegram] onMessage error (${mediaType}):`, err);
        }
      } catch (err) {
        console.error(`[telegram] failed to download ${mediaType}:`, err);
        if (caption) {
          const inbound = buildInbound(msg, access.isGroup, caption);
          try {
            await opts.onMessage!(inbound);
          } catch (err2) {
            console.error(`[telegram] onMessage error (${mediaType} fallback):`, err2);
          }
        }
      }
    });
  }

  // start long polling via runner (non-blocking)
  let runner: RunnerHandle;
  try {
    runner = run(bot);
    console.log('[telegram] monitor started');
  } catch (err) {
    console.error('[telegram] failed to start:', err);
    throw err;
  }

  // send approval request as inline keyboard to the owner
  const sendApprovalRequest = async (req: ApprovalRequest) => {
    const adminChatId = opts.allowFrom?.[0];
    if (!adminChatId) return;

    const detail = req.toolName === 'Bash' || req.toolName === 'bash'
      ? `<code>${escapeHtml(String(req.input.command || ''))}</code>`
      : `<pre>${escapeHtml(JSON.stringify(req.input, null, 2).slice(0, 500))}</pre>`;

    const text = `\u26a0\ufe0f <b>Approval Required</b>\n\nTool: <b>${escapeHtml(req.toolName)}</b>\n${detail}`;

    const keyboard = new InlineKeyboard()
      .text('\u2705 Allow', `approve:${req.requestId}`)
      .text('\u274c Deny', `deny:${req.requestId}`);

    try {
      await bot.api.sendMessage(Number(adminChatId), text, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
    } catch (err) {
      console.error('[telegram] failed to send approval request:', err);
    }
  };

  const sendQuestion = async (req: QuestionRequest) => {
    const keyboard = new InlineKeyboard();
    for (let i = 0; i < req.options.length; i++) {
      keyboard.text(req.options[i].label, `q:${req.requestId}:${i}`);
      if (i % 2 === 1) keyboard.row(); // 2 buttons per row
    }

    const lines = [`\u2753 ${escapeHtml(req.question)}`];
    for (const opt of req.options) {
      if (opt.description) lines.push(`  \u2022 <b>${escapeHtml(opt.label)}</b> — ${escapeHtml(opt.description)}`);
    }

    try {
      await bot.api.sendMessage(Number(req.chatId), lines.join('\n'), {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
    } catch (err) {
      console.error('[telegram] failed to send question:', err);
    }
  };

  const stop = async () => {
    if (runner.isRunning()) {
      runner.stop();
    }
  };

  return { stop, sendApprovalRequest, sendQuestion };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
