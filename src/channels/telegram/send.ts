import { extname } from 'node:path';
import { lookup } from 'mime-types';
import type { Api } from 'grammy';
import { InputFile } from 'grammy';
import { markdownToTelegramHtml } from './format.js';

const MSG_LIMIT = 4000; // safe margin below telegram's 4096

export function normalizeTelegramChatId(target: string): number | string {
  const trimmed = target.trim();
  // numeric chat id
  const num = Number(trimmed);
  if (!isNaN(num) && String(num) === trimmed) return num;
  // @username or channel id
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}

// check if a split point is inside an unclosed HTML tag
function isInsideTag(text: string, pos: number): boolean {
  const before = text.slice(0, pos);
  const lastOpen = before.lastIndexOf('<');
  if (lastOpen < 0) return false;
  const lastClose = before.lastIndexOf('>', lastOpen);
  return lastClose < lastOpen; // < found after last >, means we're inside a tag
}

// find unclosed block tags (pre, blockquote, code) at a split point
function getUnclosedTags(text: string): string[] {
  const stack: string[] = [];
  const re = /<(\/?)(\w+)(?:\s[^>]*)?>/g;
  let m;
  while ((m = re.exec(text))) {
    const [, closing, tag] = m;
    const t = tag.toLowerCase();
    if (t === 'pre' || t === 'blockquote' || t === 'code') {
      if (closing) {
        const idx = stack.lastIndexOf(t);
        if (idx >= 0) stack.splice(idx, 1);
      } else {
        stack.push(t);
      }
    }
  }
  return stack;
}

// split long text into chunks that respect paragraph/line/sentence boundaries
// avoids splitting inside <pre>, <code>, or <blockquote> tags
export function splitTelegramMessage(text: string, limit = MSG_LIMIT): string[] {
  if (text.length <= limit) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > limit) {
    let splitAt = -1;

    // try paragraph break
    const paraIdx = remaining.lastIndexOf('\n\n', limit);
    if (paraIdx > limit * 0.3 && !isInsideTag(remaining, paraIdx)) {
      const unclosed = getUnclosedTags(remaining.slice(0, paraIdx));
      if (unclosed.length === 0) splitAt = paraIdx;
    }

    // try line break
    if (splitAt < 0) {
      const lineIdx = remaining.lastIndexOf('\n', limit);
      if (lineIdx > limit * 0.3 && !isInsideTag(remaining, lineIdx)) {
        const unclosed = getUnclosedTags(remaining.slice(0, lineIdx));
        if (unclosed.length === 0) splitAt = lineIdx;
      }
    }

    // try sentence break
    if (splitAt < 0) {
      const sentIdx = remaining.lastIndexOf('. ', limit);
      if (sentIdx > limit * 0.3 && !isInsideTag(remaining, sentIdx)) {
        const unclosed = getUnclosedTags(remaining.slice(0, sentIdx));
        if (unclosed.length === 0) splitAt = sentIdx + 1;
      }
    }

    // fallback: close unclosed tags at limit, reopen in next chunk
    if (splitAt < 0) {
      splitAt = limit;
      const unclosed = getUnclosedTags(remaining.slice(0, splitAt));
      if (unclosed.length > 0) {
        const closeTags = unclosed.reverse().map(t => `</${t}>`).join('');
        const openTags = unclosed.reverse().map(t => `<${t}>`).join('');
        chunks.push(remaining.slice(0, splitAt).trimEnd() + closeTags);
        remaining = openTags + remaining.slice(splitAt).trimStart();
        continue;
      }
    }

    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks;
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
  const chunks = splitTelegramMessage(html);

  // send first chunk (with reply-to if any), fall back to plain text on HTML parse error
  let result;
  try {
    result = await api.sendMessage(chatId, chunks[0], {
      parse_mode: 'HTML',
      reply_parameters: opts?.replyTo ? { message_id: opts.replyTo } : undefined,
    });
  } catch (err: any) {
    if (err?.description?.includes("can't parse")) {
      console.warn('[telegram] HTML parse failed, falling back to plain text');
      const plainChunks = splitTelegramMessage(text);
      result = await api.sendMessage(chatId, plainChunks[0], {
        reply_parameters: opts?.replyTo ? { message_id: opts.replyTo } : undefined,
      });
      for (let i = 1; i < plainChunks.length; i++) {
        await api.sendMessage(chatId, plainChunks[i]);
      }
      return { id: String(result.message_id), chatId: String(result.chat.id) };
    }
    throw err;
  }

  // send remaining chunks sequentially
  for (let i = 1; i < chunks.length; i++) {
    try {
      await api.sendMessage(chatId, chunks[i], { parse_mode: 'HTML' });
    } catch (err: any) {
      if (err?.description?.includes("can't parse")) {
        console.warn(`[telegram] HTML parse failed on chunk ${i}, sending plain`);
        await api.sendMessage(chatId, chunks[i].replace(/<[^>]+>/g, ''));
      } else {
        throw err;
      }
    }
  }

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
  const html = markdownToTelegramHtml(newText);
  const chunks = splitTelegramMessage(html);

  // edit the original message with the first chunk
  try {
    await api.editMessageText(cid, Number(messageId), chunks[0], { parse_mode: 'HTML' });
  } catch (err: any) {
    if (err?.description?.includes("can't parse")) {
      console.warn('[telegram] HTML parse failed on edit, falling back to plain text');
      await api.editMessageText(cid, Number(messageId), newText.slice(0, MSG_LIMIT));
      return;
    }
    throw err;
  }

  // overflow chunks sent as new messages
  for (let i = 1; i < chunks.length; i++) {
    try {
      await api.sendMessage(cid, chunks[i], { parse_mode: 'HTML' });
    } catch (err: any) {
      if (err?.description?.includes("can't parse")) {
        await api.sendMessage(cid, chunks[i].replace(/<[^>]+>/g, ''));
      } else {
        throw err;
      }
    }
  }
}

export async function deleteTelegramMessage(
  api: Api,
  chatId: string,
  messageId: string
): Promise<void> {
  const cid = normalizeTelegramChatId(chatId);
  await api.deleteMessage(cid, Number(messageId));
}
