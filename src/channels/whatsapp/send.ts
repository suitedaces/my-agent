import { readFileSync, statSync } from 'node:fs';
import { extname, basename } from 'node:path';
import { lookup } from 'mime-types';
import type { WASocket } from './session.js';

export function toWhatsAppJid(target: string): string {
  let normalized = target.replace(/[\s\-\(\)]/g, '');
  if (normalized.includes('@g.us')) return normalized;
  normalized = normalized.replace(/^whatsapp:/i, '');
  if (normalized.startsWith('+')) normalized = normalized.slice(1);
  if (!normalized.includes('@')) normalized += '@s.whatsapp.net';
  return normalized;
}

function buildMediaContent(mediaPath: string, caption?: string): Record<string, any> {
  const stat = statSync(mediaPath);
  if (stat.size > 64 * 1024 * 1024) {
    throw new Error(`File too large (${stat.size} bytes), max 64MB`);
  }

  const buffer = readFileSync(mediaPath);
  const ext = extname(mediaPath).toLowerCase();
  const mime = lookup(mediaPath) || 'application/octet-stream';

  // images
  if (mime.startsWith('image/') && !mime.includes('svg')) {
    return { image: buffer, caption };
  }

  // videos
  if (mime.startsWith('video/')) {
    return { video: buffer, caption };
  }

  // audio
  if (mime.startsWith('audio/')) {
    const ptt = ext === '.ogg' || ext === '.opus';
    return { audio: buffer, ptt };
  }

  // everything else as document
  return { document: buffer, mimetype: mime, fileName: basename(mediaPath), caption };
}

export async function sendWhatsAppMessage(
  sock: WASocket,
  target: string,
  text: string,
  opts?: { replyTo?: { key: any }; media?: string }
): Promise<{ id: string; chatId: string }> {
  const jid = toWhatsAppJid(target);
  const quoted = opts?.replyTo ? { quoted: opts.replyTo } : undefined;

  let content: Record<string, any>;

  if (opts?.media) {
    content = buildMediaContent(opts.media, text || undefined);
  } else {
    content = { text };
  }

  const result = await sock.sendMessage(jid, content as any, quoted);
  return {
    id: result?.key?.id || `wa-${Date.now()}`,
    chatId: jid,
  };
}

export async function editWhatsAppMessage(
  sock: WASocket,
  messageId: string,
  newText: string,
  chatId: string
): Promise<void> {
  const jid = toWhatsAppJid(chatId);
  await sock.sendMessage(jid, {
    text: newText,
    edit: { remoteJid: jid, id: messageId, fromMe: true } as any,
  });
}

export async function deleteWhatsAppMessage(
  sock: WASocket,
  messageId: string,
  chatId: string
): Promise<void> {
  const jid = toWhatsAppJid(chatId);
  await sock.sendMessage(jid, {
    delete: { remoteJid: jid, id: messageId, fromMe: true } as any,
  });
}
