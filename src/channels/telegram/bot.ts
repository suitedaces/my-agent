import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Bot } from 'grammy';

export type CreateBotOptions = {
  token: string;
};

export function resolveTelegramToken(tokenFile?: string): string {
  if (tokenFile && existsSync(tokenFile)) {
    return readFileSync(tokenFile, 'utf-8').trim();
  }

  const defaultFile = join(homedir(), '.my-agent', 'telegram', 'token');
  if (existsSync(defaultFile)) {
    return readFileSync(defaultFile, 'utf-8').trim();
  }

  if (process.env.TELEGRAM_BOT_TOKEN) {
    return process.env.TELEGRAM_BOT_TOKEN;
  }

  throw new Error('No Telegram bot token found. Set TELEGRAM_BOT_TOKEN env or save to ~/.my-agent/telegram/token');
}

export function createTelegramBot(opts: CreateBotOptions): Bot {
  return new Bot(opts.token);
}
