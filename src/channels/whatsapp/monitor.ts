import { mkdirSync } from 'node:fs';
import { createWaSocket, getDefaultAuthDir, DisconnectReason, getDisconnectReason, type WASocket } from './session.js';
import { sendWhatsAppMessage, editWhatsAppMessage, deleteWhatsAppMessage, toWhatsAppJid } from './send.js';
import { registerChannelHandler } from '../../tools/messaging.js';
import type { InboundMessage } from '../types.js';

export type WhatsAppMonitorOptions = {
  authDir?: string;
  accountId?: string;
  onMessage?: (msg: InboundMessage) => Promise<void>;
  abortSignal?: AbortSignal;
};

export async function startWhatsAppMonitor(opts: WhatsAppMonitorOptions): Promise<() => Promise<void>> {
  const authDir = opts.authDir || getDefaultAuthDir();
  mkdirSync(authDir, { recursive: true });

  let sock: WASocket | null = null;
  let stopped = false;
  let reconnectTimer: NodeJS.Timeout | null = null;

  async function connect(): Promise<void> {
    if (stopped) return;

    try {
      sock = await createWaSocket({
        authDir,
        onConnection: (state, err) => {
          if (state === 'close' && !stopped) {
            const code = getDisconnectReason(err);
            if (code === DisconnectReason.loggedOut) {
              console.error('[whatsapp] logged out, needs re-login');
              return;
            }
            // reconnect with backoff
            console.log(`[whatsapp] disconnected (${code}), reconnecting in 5s...`);
            reconnectTimer = setTimeout(() => connect(), 5000);
          }
        },
      });

      // register channel handler for the message tool
      registerChannelHandler('whatsapp', {
        send: async (target, message, sendOpts) => {
          if (!sock) throw new Error('WhatsApp not connected');
          return sendWhatsAppMessage(sock, target, message, {
            media: sendOpts?.media,
          });
        },
        edit: async (messageId, message, chatId) => {
          if (!sock) throw new Error('WhatsApp not connected');
          await editWhatsAppMessage(sock, messageId, message, chatId || '');
        },
        delete: async (messageId, chatId) => {
          if (!sock) throw new Error('WhatsApp not connected');
          await deleteWhatsAppMessage(sock, messageId, chatId || '');
        },
      });

      // listen for messages
      sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
          if (msg.key.fromMe) continue;
          if (msg.key.remoteJid === 'status@broadcast') continue;

          const text = msg.message?.conversation
            || msg.message?.extendedTextMessage?.text
            || '';

          if (!text) continue;

          const remoteJid = msg.key.remoteJid || '';
          const isGroup = remoteJid.endsWith('@g.us');
          const senderId = isGroup
            ? (msg.key.participant || remoteJid)
            : remoteJid;

          const inbound: InboundMessage = {
            id: msg.key.id || `wa-${Date.now()}`,
            channel: 'whatsapp',
            accountId: opts.accountId || '',
            chatId: remoteJid,
            chatType: isGroup ? 'group' : 'dm',
            senderId: senderId.split('@')[0],
            senderName: msg.pushName || undefined,
            body: text,
            timestamp: (msg.messageTimestamp as number) * 1000 || Date.now(),
            replyToId: msg.message?.extendedTextMessage?.contextInfo?.stanzaId || undefined,
            raw: msg,
          };

          // mark as read
          try {
            await sock!.readMessages([msg.key]);
          } catch {}

          if (opts.onMessage) {
            await opts.onMessage(inbound);
          }
        }
      });

      console.log('[whatsapp] monitor started');
    } catch (err) {
      console.error('[whatsapp] connection error:', err);
      if (!stopped) {
        reconnectTimer = setTimeout(() => connect(), 5000);
      }
    }
  }

  await connect();

  return async () => {
    stopped = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (sock) {
      sock.end(undefined);
      sock = null;
    }
  };
}
