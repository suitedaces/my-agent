/// <reference types="vite/client" />

interface Window {
  electronAPI?: {
    platform: string;
    getGatewayToken?: () => string | null;
    openExternal?: (url: string) => Promise<void>;
  };
}
