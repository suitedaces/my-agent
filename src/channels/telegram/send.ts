import type { Api } from 'grammy';

export function normalizeTelegramChatId(target: string): number | string {
  const trimmed = target.trim();
  // numeric chat id
  const num = Number(trimmed);
  if (!isNaN(num) && String(num) === trimmed) return num;
  // @username or channel id
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}

export async function sendTelegramMessage(
  api: Api,
  target: string,
  text: string,
  opts?: { replyTo?: number }
): Promise<{ id: string; chatId: string }> {
  const chatId = normalizeTelegramChatId(target);
  const result = await api.sendMessage(chatId, text, {
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
  await api.editMessageText(cid, Number(messageId), newText, { parse_mode: 'HTML' });
}

export async function deleteTelegramMessage(
  api: Api,
  chatId: string,
  messageId: string
): Promise<void> {
  const cid = normalizeTelegramChatId(chatId);
  await api.deleteMessage(cid, Number(messageId));
}
