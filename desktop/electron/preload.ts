import { contextBridge, shell } from 'electron';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

function readGatewayToken(): string | null {
  const tokenPath = join(homedir(), '.dorabot', 'gateway-token');
  if (existsSync(tokenPath)) {
    return readFileSync(tokenPath, 'utf-8').trim();
  }
  return null;
}

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  getGatewayToken: readGatewayToken,
  openExternal: (url: string) => shell.openExternal(url),
});
