import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Bot } from 'grammy';

export type CreateBotOptions = {
  token: string;
};

export function resolveTelegramToken(configToken?: string, tokenFile?: string): string {
  if (configToken) return configToken;

  if (tokenFile && existsSync(tokenFile)) {
    return readFileSync(tokenFile, 'utf-8').trim();
  }

  // check default token file
  const defaultFile = join(homedir(), '.my-agent', 'telegram', 'token');
  if (existsSync(defaultFile)) {
    return readFileSync(defaultFile, 'utf-8').trim();
  }

  // env var fallback
  if (process.env.TELEGRAM_BOT_TOKEN) {
    return process.env.TELEGRAM_BOT_TOKEN;
  }

  throw new Error('No Telegram bot token found. Set botToken in config, TELEGRAM_BOT_TOKEN env, or save to ~/.my-agent/telegram/token');
}

export function createTelegramBot(opts: CreateBotOptions): Bot {
  return new Bot(opts.token);
}
