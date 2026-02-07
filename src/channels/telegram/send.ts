import { extname } from 'node:path';
import { lookup } from 'mime-types';
import type { Api } from 'grammy';
import { InputFile } from 'grammy';
import { markdownToTelegramHtml } from './format.js';

export function normalizeTelegramChatId(target: string): number | string {
  const trimmed = target.trim();
  // numeric chat id
  const num = Number(trimmed);
  if (!isNaN(num) && String(num) === trimmed) return num;
  // @username or channel id
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}

async function sendMedia(
  api: Api,
  chatId: number | string,
  mediaPath: string,
  caption?: string,
  replyTo?: number
): Promise<{ id: string; chatId: string }> {
  const mime = lookup(mediaPath) || 'application/octet-stream';
  const file = new InputFile(mediaPath);
  const replyParams = replyTo ? { message_id: replyTo } : undefined;
  const opts: any = {
    caption: caption ? markdownToTelegramHtml(caption) : undefined,
    parse_mode: 'HTML' as const,
    reply_parameters: replyParams,
  };

  let result;

  if (mime.startsWith('image/') && !mime.includes('svg')) {
    result = await api.sendPhoto(chatId, file, opts);
  } else if (mime.startsWith('video/')) {
    result = await api.sendVideo(chatId, file, opts);
  } else if (mime.startsWith('audio/')) {
    result = await api.sendAudio(chatId, file, opts);
  } else {
    result = await api.sendDocument(chatId, file, opts);
  }

  return {
    id: String(result.message_id),
    chatId: String(result.chat.id),
  };
}

export async function sendTelegramMessage(
  api: Api,
  target: string,
  text: string,
  opts?: { replyTo?: number; media?: string }
): Promise<{ id: string; chatId: string }> {
  const chatId = normalizeTelegramChatId(target);

  if (opts?.media) {
    return sendMedia(api, chatId, opts.media, text || undefined, opts.replyTo);
  }

  const html = markdownToTelegramHtml(text);
  const result = await api.sendMessage(chatId, html, {
    parse_mode: 'HTML',
    reply_parameters: opts?.replyTo ? { message_id: opts.replyTo } : undefined,
  });
  return {
    id: String(result.message_id),
    chatId: String(result.chat.id),
  };
}

export async function editTelegramMessage(
  api: Api,
  chatId: string,
  messageId: string,
  newText: string
): Promise<void> {
  const cid = normalizeTelegramChatId(chatId);
  await api.editMessageText(cid, Number(messageId), markdownToTelegramHtml(newText), { parse_mode: 'HTML' });
}

export async function deleteTelegramMessage(
  api: Api,
  chatId: string,
  messageId: string
): Promise<void> {
  const cid = normalizeTelegramChatId(chatId);
  await api.deleteMessage(cid, Number(messageId));
}
