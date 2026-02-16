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
  appVersion: (() => { try { return require('electron').app?.getVersion?.() || process.env.npm_package_version || '0.0.0'; } catch { return '0.0.0'; } })(),
  consumeGatewayToken: (): string | null => {
    if (tokenDelivered) return null;
    tokenDelivered = true;
    return gatewayToken;
  },
  openExternal: (url: string) => shell.openExternal(url),
  dockBounce: (type: 'critical' | 'informational') => ipcRenderer.send('dock-bounce', type),
  notify: (title: string, body: string) => ipcRenderer.send('notify', { title, body }),
  onCloseTab: (cb: () => void) => {
    ipcRenderer.on('close-tab', cb);
    return () => { ipcRenderer.removeListener('close-tab', cb); };
  },
  // Auto-update IPC
  checkForUpdate: () => ipcRenderer.send('update-check'),
  downloadUpdate: () => ipcRenderer.send('update-download'),
  installUpdate: () => ipcRenderer.send('update-install'),
  onUpdateStatus: (cb: (status: { event: string; version?: string; percent?: number; message?: string; releaseNotes?: string }) => void) => {
    const handler = (_e: any, status: any) => cb(status);
    ipcRenderer.on('update-status', handler);
    return () => { ipcRenderer.removeListener('update-status', handler); };
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

export type ElectronAPI = typeof electronAPI;
