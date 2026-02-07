import { contextBridge } from 'electron';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

function readGatewayToken(): string | null {
  const tokenPath = join(homedir(), '.my-agent', 'gateway-token');
  if (existsSync(tokenPath)) {
    return readFileSync(tokenPath, 'utf-8').trim();
  }
  return null;
}

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  gatewayToken: readGatewayToken(),
});
