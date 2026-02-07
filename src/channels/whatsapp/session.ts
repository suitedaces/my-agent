import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import makeWASocket, {
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  DisconnectReason,
  Browsers,
  type WASocket,
} from '@whiskeysockets/baileys';

export { DisconnectReason };
export type { WASocket };

export type CreateSocketOptions = {
  authDir: string;
  onQr?: (qr: string) => void;
  onConnection?: (state: 'open' | 'connecting' | 'close', error?: Error) => void;
  verbose?: boolean;
};

export function getDefaultAuthDir(): string {
  return join(homedir(), '.my-agent', 'whatsapp', 'auth');
}

export async function createWaSocket(opts: CreateSocketOptions): Promise<WASocket> {
  const { state, saveCreds } = await useMultiFileAuthState(opts.authDir);

  const sock = makeWASocket({
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys),
    },
    browser: Browsers.macOS('my-agent'),
    printQRInTerminal: !opts.onQr,
    markOnlineOnConnect: false,
    getMessage: async () => undefined,
  });

  sock.ev.on('creds.update', saveCreds);

  if (opts.onQr) {
    sock.ev.on('connection.update', (update) => {
      if (update.qr) opts.onQr!(update.qr);
    });
  }

  if (opts.onConnection) {
    sock.ev.on('connection.update', (update) => {
      if (update.connection) {
        const err = update.lastDisconnect?.error as Error | undefined;
        opts.onConnection!(update.connection, err);
      }
    });
  }

  return sock;
}

export function waitForConnection(sock: WASocket): Promise<void> {
  return new Promise((resolve, reject) => {
    const handler = (update: any) => {
      if (update.connection === 'open') {
        sock.ev.off('connection.update', handler);
        resolve();
      } else if (update.connection === 'close') {
        sock.ev.off('connection.update', handler);
        const code = (update.lastDisconnect?.error as any)?.output?.statusCode;
        reject(new Error(`Connection closed: ${code}`));
      }
    };
    sock.ev.on('connection.update', handler);
  });
}

export function getDisconnectReason(error: unknown): number | undefined {
  return (error as any)?.output?.statusCode;
}

export function isAuthenticated(authDir: string): boolean {
  const credsPath = join(authDir, 'creds.json');
  if (!existsSync(credsPath)) return false;
  try {
    const creds = JSON.parse(readFileSync(credsPath, 'utf-8'));
    return creds.registered === true;
  } catch {
    return false;
  }
}
