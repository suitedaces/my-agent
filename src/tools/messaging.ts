import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';

export type ChannelHandler = {
  send(target: string, message: string, opts?: { media?: string; replyTo?: string }): Promise<{ id: string; chatId: string }>;
  edit(messageId: string, message: string, chatId?: string): Promise<void>;
  delete(messageId: string, chatId?: string): Promise<void>;
};

// registry for channel handlers (populated at runtime)
const channelHandlers = new Map<string, ChannelHandler>();

export function registerChannelHandler(channel: string, handler: ChannelHandler): void {
  channelHandlers.set(channel, handler);
}

export function getChannelHandler(channel: string): ChannelHandler | undefined {
  return channelHandlers.get(channel);
}

// console fallback handler
const consoleHandler: ChannelHandler = {
  async send(target, message) {
    console.log(`[${target}] ${message}`);
    return { id: `console-${Date.now()}`, chatId: target };
  },
  async edit(messageId, message) {
    console.log(`[edit ${messageId}] ${message}`);
  },
  async delete(messageId) {
    console.log(`[delete ${messageId}]`);
  },
};

function getHandler(channel: string): ChannelHandler {
  return channelHandlers.get(channel) || consoleHandler;
}

export const messageTool = tool(
  'message',
  'Send, edit, or delete messages on messaging channels (WhatsApp, Telegram, Discord, Slack, etc.)',
  {
    action: z.enum(['send', 'edit', 'delete']),
    channel: z.string().describe('Channel name: whatsapp, telegram, discord, slack, signal, console'),
    target: z.string().optional().describe('Recipient ID, chat ID, or channel ID'),
    message: z.string().optional().describe('Message content (for send/edit). Telegram uses HTML parse mode: <b>, <i>, <code>, <pre>, <a href="url">. Do not use markdown for Telegram.'),
    messageId: z.string().optional().describe('Message ID to edit or delete'),
    chatId: z.string().optional().describe('Chat ID (required for edit/delete on some channels)'),
    media: z.string().optional().describe('Path to media file to attach'),
    replyTo: z.string().optional().describe('Message ID to reply to'),
  },
  async (args) => {
    const handler = getHandler(args.channel);

    switch (args.action) {
      case 'send': {
        if (!args.target || !args.message) {
          return {
            content: [{ type: 'text', text: 'Error: target and message required for send' }],
            isError: true,
          };
        }
        const result = await handler.send(args.target, args.message, {
          media: args.media,
          replyTo: args.replyTo,
        });
        return {
          content: [{ type: 'text', text: `Message sent. ID: ${result.id}` }],
        };
      }

      case 'edit': {
        if (!args.messageId || !args.message) {
          return {
            content: [{ type: 'text', text: 'Error: messageId and message required for edit' }],
            isError: true,
          };
        }
        await handler.edit(args.messageId, args.message, args.chatId || args.target);
        return {
          content: [{ type: 'text', text: `Message ${args.messageId} edited` }],
        };
      }

      case 'delete': {
        if (!args.messageId) {
          return {
            content: [{ type: 'text', text: 'Error: messageId required for delete' }],
            isError: true,
          };
        }
        await handler.delete(args.messageId, args.chatId || args.target);
        return {
          content: [{ type: 'text', text: `Message ${args.messageId} deleted` }],
        };
      }

      default:
        return {
          content: [{ type: 'text', text: `Unknown action: ${args.action}` }],
          isError: true,
        };
    }
  }
);
