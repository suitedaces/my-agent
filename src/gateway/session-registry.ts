import type { SessionInfo } from './types.js';

export class SessionRegistry {
  private sessions = new Map<string, SessionInfo>();
  private activeRuns = new Set<string>();

  makeKey(msg: { channel: string; chatType?: string; chatId: string }): string {
    return `${msg.channel}:${msg.chatType || 'dm'}:${msg.chatId}`;
  }

  getOrCreate(msg: { channel: string; chatType?: string; chatId: string; sessionId?: string }): SessionInfo {
    const key = this.makeKey(msg);
    let session = this.sessions.get(key);
    if (!session) {
      session = {
        key,
        channel: msg.channel,
        chatId: msg.chatId,
        chatType: msg.chatType || 'dm',
        sessionId: msg.sessionId || key,
        sdkSessionId: undefined,
        messageCount: 0,
        lastMessageAt: Date.now(),
        activeRun: false,
      };
      this.sessions.set(key, session);
    }
    return session;
  }

  setSdkSessionId(key: string, sdkSessionId: string): void {
    const s = this.sessions.get(key);
    if (s) s.sdkSessionId = sdkSessionId;
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
    return this.sessions.delete(key);
  }

  clear(): void {
    this.sessions.clear();
    this.activeRuns.clear();
  }
}
