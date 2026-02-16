import { mkdirSync } from 'node:fs';
import { createWaSocket, getDefaultAuthDir, DisconnectReason, getDisconnectReason, isAuthenticated, type WASocket } from './session.js';
import { sendWhatsAppMessage, editWhatsAppMessage, deleteWhatsAppMessage, toWhatsAppJid } from './send.js';
import { registerChannelHandler } from '../../tools/messaging.js';
import type { InboundMessage } from '../types.js';

export type ApprovalRequest = {
  requestId: string;
  toolName: string;
  input: Record<string, unknown>;
  chatId: string;
};

export type QuestionRequest = {
  requestId: string;
  chatId: string;
  question: string;
  options: { label: string; description?: string }[];
};

export type WhatsAppMonitorOptions = {
  authDir?: string;
  accountId?: string;
  allowFrom?: string[];
  groupPolicy?: 'open' | 'allowlist' | 'disabled';
  onMessage?: (msg: InboundMessage) => Promise<void>;
  onCommand?: (cmd: string, chatId: string) => Promise<string | void>;
  onApprovalResponse?: (requestId: string, approved: boolean, reason?: string) => void;
  onQuestionResponse?: (requestId: string, selectedIndex: number, label: string) => void;
  abortSignal?: AbortSignal;
};

export type WhatsAppMonitorHandle = {
  stop: () => Promise<void>;
  sendApprovalRequest: (req: ApprovalRequest) => Promise<void>;
  sendQuestion: (req: QuestionRequest) => Promise<void>;
};

type PendingApproval = {
  requestId: string;
};

type PendingQuestion = {
  requestId: string;
  options: { label: string; description?: string }[];
};

export async function startWhatsAppMonitor(opts: WhatsAppMonitorOptions): Promise<WhatsAppMonitorHandle> {
  const authDir = opts.authDir || getDefaultAuthDir();
  mkdirSync(authDir, { recursive: true });

  let sock: WASocket | null = null;
  let stopped = false;
  let reconnectTimer: NodeJS.Timeout | null = null;

  // pending interactions keyed by chatId (one per chat at a time)
  const pendingApprovals = new Map<string, PendingApproval>();
  const pendingQuestions = new Map<string, PendingQuestion>();

  async function connect(): Promise<void> {
    if (stopped) return;

    if (!isAuthenticated(authDir)) {
      console.error('[whatsapp] no credentials found, use whatsapp:login to link');
      return;
    }

    try {
      sock = await createWaSocket({
        authDir,
        onConnection: (state, err) => {
          if (state === 'close' && !stopped) {
            const code = getDisconnectReason(err);
            if (code === DisconnectReason.loggedOut || code === 405) {
              console.error('[whatsapp] logged out (code ' + code + '), needs re-login');
              return;
            }
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
            replyTo: sendOpts?.replyTo,
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
        typing: async (chatId) => {
          if (!sock) return;
          try {
            await sock.sendPresenceUpdate('composing', toWhatsAppJid(chatId));
          } catch {}
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

          // group policy check
          if (isGroup && opts.groupPolicy === 'disabled') continue;

          // sender auth check
          const senderPhone = senderId.split('@')[0];
          if (opts.allowFrom && opts.allowFrom.length > 0) {
            if (!opts.allowFrom.includes(senderPhone)) {
              console.log(`[whatsapp] unauthorized sender: ${senderPhone} (${msg.pushName || 'unknown'})`);
              continue;
            }
          } else if (opts.allowFrom && opts.allowFrom.length === 0) {
            console.log('[whatsapp] no authorized senders configured, rejecting all messages');
            continue;
          }

          // mark as read
          try {
            await sock!.readMessages([msg.key]);
          } catch {}

          const trimmed = text.trim();

          // check for pending approval response
          const pendingApproval = pendingApprovals.get(remoteJid);
          if (pendingApproval) {
            const lower = trimmed.toLowerCase();
            if (lower === '1' || lower === 'allow' || lower === 'yes' || lower === 'y') {
              pendingApprovals.delete(remoteJid);
              opts.onApprovalResponse?.(pendingApproval.requestId, true);
              continue;
            }
            if (lower === '2' || lower === 'deny' || lower === 'no' || lower === 'n') {
              pendingApprovals.delete(remoteJid);
              opts.onApprovalResponse?.(pendingApproval.requestId, false, 'denied via whatsapp');
              continue;
            }
          }

          // check for pending question response
          const pendingQuestion = pendingQuestions.get(remoteJid);
          if (pendingQuestion) {
            const num = parseInt(trimmed, 10);
            if (!isNaN(num) && num >= 1 && num <= pendingQuestion.options.length) {
              pendingQuestions.delete(remoteJid);
              const idx = num - 1;
              opts.onQuestionResponse?.(pendingQuestion.requestId, idx, pendingQuestion.options[idx].label);
              continue;
            }
          }

          // check for commands (/new, /status)
          if (trimmed.startsWith('/') && opts.onCommand) {
            const cmd = trimmed.slice(1).split(/\s+/)[0].toLowerCase();
            if (cmd === 'new' || cmd === 'status') {
              const reply = await opts.onCommand(cmd, remoteJid);
              if (reply && sock) {
                try {
                  await sendWhatsAppMessage(sock, remoteJid, reply);
                } catch {}
              }
              continue;
            }
          }

          // quoted message body when replying, if available
          // keeps enough context to recover pulse session markers from replies
          const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage as any;
          const replyToBody = quoted?.conversation || quoted?.extendedTextMessage?.text || undefined;

          const inbound: InboundMessage = {
            id: msg.key.id || `wa-${Date.now()}`,
            channel: 'whatsapp',
            accountId: opts.accountId || '',
            chatId: remoteJid,
            chatType: isGroup ? 'group' : 'dm',
            senderId: senderPhone,
            senderName: msg.pushName || undefined,
            body: text,
            timestamp: (msg.messageTimestamp as number) * 1000 || Date.now(),
            replyToId: msg.message?.extendedTextMessage?.contextInfo?.stanzaId || undefined,
            replyToBody,
            raw: msg,
          };

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

  const sendApprovalRequest = async (req: ApprovalRequest) => {
    if (!sock) return;
    const jid = toWhatsAppJid(req.chatId);

    const detail = req.toolName === 'Bash' || req.toolName === 'bash'
      ? `\`${String(req.input.command || '')}\``
      : JSON.stringify(req.input, null, 2).slice(0, 500);

    const text = [
      `⚠️ *Approval Required*`,
      ``,
      `Tool: *${req.toolName}*`,
      detail,
      ``,
      `Reply *1* to Allow or *2* to Deny`,
    ].join('\n');

    pendingApprovals.set(jid, { requestId: req.requestId });

    try {
      await sendWhatsAppMessage(sock, jid, text);
    } catch (err) {
      console.error('[whatsapp] failed to send approval request:', err);
      pendingApprovals.delete(jid);
    }
  };

  const sendQuestion = async (req: QuestionRequest) => {
    if (!sock) return;
    const jid = toWhatsAppJid(req.chatId);

    const lines = [`❓ *${req.question}*`, ''];
    for (let i = 0; i < req.options.length; i++) {
      const opt = req.options[i];
      if (opt.description) {
        lines.push(`*${i + 1}.* ${opt.label} — ${opt.description}`);
      } else {
        lines.push(`*${i + 1}.* ${opt.label}`);
      }
    }
    lines.push('', 'Reply with a number');

    pendingQuestions.set(jid, { requestId: req.requestId, options: req.options });

    try {
      await sendWhatsAppMessage(sock, jid, lines.join('\n'));
    } catch (err) {
      console.error('[whatsapp] failed to send question:', err);
      pendingQuestions.delete(jid);
    }
  };

  const stop = async () => {
    stopped = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (sock) {
      sock.end(undefined);
      sock = null;
    }
  };

  return { stop, sendApprovalRequest, sendQuestion };
}
