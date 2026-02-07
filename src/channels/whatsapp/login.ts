import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { createWaSocket, waitForConnection, getDefaultAuthDir, isAuthenticated } from './session.js';

export type LoginResult = { success: boolean; error?: string; selfJid?: string };

export async function loginWhatsApp(authDir?: string): Promise<LoginResult> {
  const dir = authDir || getDefaultAuthDir();
  mkdirSync(dir, { recursive: true });

  console.log('Connecting to WhatsApp... scan QR code when it appears.');

  try {
    const sock = await createWaSocket({
      authDir: dir,
      onQr: (qr) => {
        try {
          const qrt = require('qrcode-terminal');
          qrt.generate(qr, { small: true });
        } catch {
          console.log('QR code:', qr);
        }
      },
      onConnection: (state, err) => {
        if (state === 'open') {
          console.log('WhatsApp connected!');
        } else if (state === 'close') {
          console.log('Connection closed:', err?.message);
        }
      },
    });

    await waitForConnection(sock);

    const selfJid = (sock as any).authState?.creds?.me?.id;
    console.log(`Logged in as: ${selfJid || 'unknown'}`);

    // disconnect after login
    sock.end(undefined);

    return { success: true, selfJid };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { success: false, error };
  }
}

export async function logoutWhatsApp(authDir?: string): Promise<void> {
  const dir = authDir || getDefaultAuthDir();
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
    console.log('WhatsApp session removed.');
  } else {
    console.log('No WhatsApp session found.');
  }
}

export function isWhatsAppLinked(authDir?: string): boolean {
  const dir = authDir || getDefaultAuthDir();
  return isAuthenticated(dir);
}
