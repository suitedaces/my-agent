import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import type { SessionInfo } from './types.js';

export class SessionRegistry {
  private sessions = new Map<string, SessionInfo>();
  private activeRuns = new Set<string>();
  private registryPath: string;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(registryPath: string) {
    this.registryPath = registryPath;
  }

  loadFromDisk(): void {
    try {
      if (existsSync(this.registryPath)) {
        const data = JSON.parse(readFileSync(this.registryPath, 'utf-8')) as Record<string, SessionInfo>;
        for (const [key, info] of Object.entries(data)) {
          info.activeRun = false;
          this.sessions.set(key, info);
        }
        console.log(`[registry] loaded ${this.sessions.size} sessions from disk`);
      }
    } catch (err) {
      console.error('[registry] failed to load from disk:', err);
    }
  }

  saveToDisk(): void {
    try {
      const obj: Record<string, SessionInfo> = {};
      for (const [key, info] of this.sessions) {
        obj[key] = { ...info, activeRun: false };
      }
      writeFileSync(this.registryPath, JSON.stringify(obj, null, 2));
    } catch (err) {
      console.error('[registry] failed to save to disk:', err);
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveToDisk();
      this.saveTimer = null;
    }, 1000);
  }

  makeKey(msg: { channel: string; chatType?: string; chatId: string }): string {
    const sanitizedChatId = msg.chatId.replace(/[\/\\\.]+/g, '_').replace(/^_+|_+$/g, '');
    return `${msg.channel}:${msg.chatType || 'dm'}:${sanitizedChatId}`;
  }

  getOrCreate(msg: { channel: string; chatType?: string; chatId: string; sessionId?: string }): SessionInfo {
    const key = this.makeKey(msg);
    let session = this.sessions.get(key);
    if (!session) {
      const chatType = msg.chatType || 'dm';
      session = {
        key,
        channel: msg.channel,
        chatId: msg.chatId,
        chatType,
        sessionId: msg.sessionId || `${msg.channel}-${chatType}-${msg.chatId}-${Date.now()}`,
        sdkSessionId: undefined,
        messageCount: 0,
        lastMessageAt: Date.now(),
        activeRun: false,
      };
      this.sessions.set(key, session);
      this.scheduleSave();
    }
    return session;
  }

  setSdkSessionId(key: string, sdkSessionId: string): void {
    const s = this.sessions.get(key);
    if (s) {
      s.sdkSessionId = sdkSessionId;
      this.scheduleSave();
    }
  }

  get(key: string): SessionInfo | undefined {
    return this.sessions.get(key);
  }

  list(): SessionInfo[] {
    return Array.from(this.sessions.values());
  }

  incrementMessages(key: string): void {
    const s = this.sessions.get(key);
    if (s) {
      s.messageCount++;
      s.lastMessageAt = Date.now();
      this.scheduleSave();
    }
  }

  setActiveRun(key: string, active: boolean): void {
    const s = this.sessions.get(key);
    if (s) s.activeRun = active;
    if (active) this.activeRuns.add(key);
    else this.activeRuns.delete(key);
  }

  hasActiveRun(): boolean {
    return this.activeRuns.size > 0;
  }

  getActiveRunKeys(): string[] {
    return Array.from(this.activeRuns);
  }

  remove(key: string): boolean {
    this.activeRuns.delete(key);
    const removed = this.sessions.delete(key);
    if (removed) this.scheduleSave();
    return removed;
  }

  clear(): void {
    this.sessions.clear();
    this.activeRuns.clear();
    this.scheduleSave();
  }
}
