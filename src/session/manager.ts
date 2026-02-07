import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import type { Config } from '../config.js';

export type SessionInfo = {
  id: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  path: string;
};

export type SessionMessage = {
  type: 'user' | 'assistant' | 'system' | 'result';
  uuid?: string;
  timestamp: string;
  content: unknown;
};

export class SessionManager {
  private sessionDir: string;

  constructor(config: Config) {
    this.sessionDir = config.sessionDir;
    this.ensureDir();
  }

  private ensureDir(): void {
    if (!existsSync(this.sessionDir)) {
      mkdirSync(this.sessionDir, { recursive: true });
    }
  }

  private getSessionPath(sessionId: string): string {
    return join(this.sessionDir, `${sessionId}.jsonl`);
  }

  generateSessionId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).slice(2, 8);
    return `session-${timestamp}-${random}`;
  }

  exists(sessionId: string): boolean {
    return existsSync(this.getSessionPath(sessionId));
  }

  load(sessionId: string): SessionMessage[] {
    const path = this.getSessionPath(sessionId);
    if (!existsSync(path)) {
      return [];
    }

    const content = readFileSync(path, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim());

    return lines.map(line => {
      try {
        return JSON.parse(line) as SessionMessage;
      } catch {
        return null;
      }
    }).filter((m): m is SessionMessage => m !== null);
  }

  append(sessionId: string, message: SessionMessage): void {
    const path = this.getSessionPath(sessionId);
    const line = JSON.stringify(message) + '\n';

    if (existsSync(path)) {
      const existing = readFileSync(path, 'utf-8');
      writeFileSync(path, existing + line);
    } else {
      writeFileSync(path, line);
    }
  }

  save(sessionId: string, messages: SessionMessage[]): void {
    const path = this.getSessionPath(sessionId);
    const content = messages.map(m => JSON.stringify(m)).join('\n') + '\n';
    writeFileSync(path, content);
  }

  list(): SessionInfo[] {
    const files = readdirSync(this.sessionDir)
      .filter(f => f.endsWith('.jsonl'));

    return files.map(file => {
      const path = join(this.sessionDir, file);
      const stat = statSync(path);
      const id = basename(file, '.jsonl');

      const content = readFileSync(path, 'utf-8');
      const lines = content.split('\n').filter(l => l.trim());

      return {
        id,
        createdAt: stat.birthtime.toISOString(),
        updatedAt: stat.mtime.toISOString(),
        messageCount: lines.length,
        path,
      };
    }).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  getLatest(): SessionInfo | null {
    const sessions = this.list();
    return sessions[0] || null;
  }

  delete(sessionId: string): boolean {
    const path = this.getSessionPath(sessionId);
    if (existsSync(path)) {
      const { unlinkSync } = require('node:fs');
      unlinkSync(path);
      return true;
    }
    return false;
  }

  // get the session ID for resuming with the SDK
  getResumeId(sessionId: string): string | undefined {
    if (this.exists(sessionId)) {
      return sessionId;
    }
    return undefined;
  }
}

// helper to convert SDK messages to our session format
export function sdkMessageToSession(msg: unknown): SessionMessage | null {
  const m = msg as Record<string, unknown>;
  if (!m || typeof m !== 'object') return null;

  const type = m.type as string;
  if (!['user', 'assistant', 'system', 'result'].includes(type)) {
    return null;
  }

  return {
    type: type as SessionMessage['type'],
    uuid: m.uuid as string | undefined,
    timestamp: new Date().toISOString(),
    content: m,
  };
}
