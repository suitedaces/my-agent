import { contextBridge, shell, ipcRenderer } from 'electron';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// Read token once at preload time — not exposed as a re-callable function.
// This prevents malicious scripts from repeatedly extracting the token.
const tokenPath = join(homedir(), '.dorabot', 'gateway-token');
const gatewayToken = existsSync(tokenPath)
  ? readFileSync(tokenPath, 'utf-8').trim()
  : null;

let tokenDelivered = false;

const electronAPI = {
  platform: process.platform,
  consumeGatewayToken: (): string | null => {
    if (tokenDelivered) return null;
    tokenDelivered = true;
    return gatewayToken;
  },
  openExternal: (url: string) => shell.openExternal(url),
  onCloseTab: (cb: () => void) => {
    ipcRenderer.on('close-tab', cb);
    return () => { ipcRenderer.removeListener('close-tab', cb); };
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

export type ElectronAPI = typeof electronAPI;
