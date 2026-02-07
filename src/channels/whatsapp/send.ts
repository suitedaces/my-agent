import type { WASocket } from './session.js';

export function toWhatsAppJid(target: string): string {
  let normalized = target.replace(/[\s\-\(\)]/g, '');
  if (normalized.includes('@g.us')) return normalized;
  normalized = normalized.replace(/^whatsapp:/i, '');
  if (normalized.startsWith('+')) normalized = normalized.slice(1);
  if (!normalized.includes('@')) normalized += '@s.whatsapp.net';
  return normalized;
}

export async function sendWhatsAppMessage(
  sock: WASocket,
  target: string,
  text: string,
  opts?: { replyTo?: { key: any }; media?: string }
): Promise<{ id: string; chatId: string }> {
  const jid = toWhatsAppJid(target);
  const result = await sock.sendMessage(jid, { text }, opts?.replyTo ? { quoted: opts.replyTo } : undefined);
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
