import { app, BrowserWindow, Tray, Menu, nativeImage, session, ipcMain, Notification as ElectronNotification } from 'electron';
import { autoUpdater } from 'electron-updater';
import { is } from '@electron-toolkit/utils';
import * as path from 'path';
import { GatewayManager } from './gateway-manager';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let gatewayManager: GatewayManager | null = null;

// --- Auto-updater setup ---
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

function sendUpdateStatus(event: string, data?: any): void {
  mainWindow?.webContents.send('update-status', { event, ...data });
}

function setupAutoUpdater(): void {
  autoUpdater.on('checking-for-update', () => {
    console.log('[updater] Checking for updates...');
    sendUpdateStatus('checking');
  });

  autoUpdater.on('update-available', (info) => {
    console.log(`[updater] Update available: ${info.version}`);
    sendUpdateStatus('available', { version: info.version, releaseNotes: info.releaseNotes });
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[updater] No updates available');
    sendUpdateStatus('not-available');
  });

  autoUpdater.on('download-progress', (progress) => {
    sendUpdateStatus('downloading', { percent: Math.round(progress.percent) });
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log(`[updater] Update downloaded: ${info.version}`);
    sendUpdateStatus('downloaded', { version: info.version });
  });

  autoUpdater.on('error', (err) => {
    console.error('[updater] Error:', err.message);
    sendUpdateStatus('error', { message: err.message });
  });

  // IPC handlers for renderer
  ipcMain.on('update-check', () => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.error('[updater] Check failed:', err.message);
    });
  });

  ipcMain.on('update-download', () => {
    autoUpdater.downloadUpdate().catch((err) => {
      console.error('[updater] Download failed:', err.message);
    });
  });

  ipcMain.on('update-install', () => {
    autoUpdater.quitAndInstall(false, true);
  });

  // Check for updates 10s after launch, then every 4 hours
  if (!is.dev) {
    setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 10_000);
    setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 4 * 60 * 60 * 1000);
  }
}

function getIconPath(): string {
  return is.dev
    ? path.join(__dirname, '../../public/dorabot.png')
    : path.join(__dirname, '../renderer/dorabot.png');
}

function showAppNotification(title: string, body: string): void {
  try {
    if (!ElectronNotification.isSupported()) return;
    new ElectronNotification({
      title,
      body,
      icon: getIconPath(),
    }).show();
  } catch (err) {
    console.error('[main] Notification failed:', err);
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0d1117',
    icon: getIconPath(),
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Intercept Cmd+W: prevent window close, tell renderer to close a tab instead
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if ((input.meta || input.control) && input.key.toLowerCase() === 'w' && !input.shift) {
      event.preventDefault();
      mainWindow?.webContents.send('close-tab');
    }
  });

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  // minimize to tray on close
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray(): void {
  const icon = nativeImage.createFromPath(getIconPath()).resize({ width: 18, height: 18 });

  tray = new Tray(icon);
  tray.setToolTip('dorabot');
  updateTrayTitle('idle');

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open dorabot', click: showWindow },
    { type: 'separator' },
    { label: 'Status: idle', enabled: false, id: 'status' },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('click', showWindow);
}

function showWindow(): void {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  } else {
    createWindow();
  }
}

function updateTrayTitle(status: string): void {
  if (tray) {
    tray.setTitle(` ${status}`);
  }
}

// Trust the self-signed gateway TLS cert for localhost connections
app.on('certificate-error', (event, _webContents, url, _error, _cert, callback) => {
  const parsed = new URL(url);
  if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
    event.preventDefault();
    callback(true);
  } else {
    callback(false);
  }
});

app.on('ready', async () => {
  // Accept self-signed gateway cert for localhost WebSocket connections
  session.defaultSession.setCertificateVerifyProc((request, callback) => {
    if (request.hostname === 'localhost' || request.hostname === '127.0.0.1') {
      callback(0); // trust
    } else {
      callback(-3); // use default verification
    }
  });

  if (app.dock) {
    app.dock.setIcon(getIconPath());
  }

  // Start gateway server before creating UI
  gatewayManager = new GatewayManager({
    onReady: () => {
      console.log('[main] Gateway ready');
      updateTrayTitle('online');
    },
    onError: (error) => {
      console.error('[main] Gateway error:', error);
      // Keep tray status actionable without getting stuck in a hard "error" state
      // for transient startup issues. onReady/onExit will update it again.
      updateTrayTitle('offline');
    },
    onExit: (code) => {
      console.log('[main] Gateway exited:', code);
      if (!isQuitting) {
        updateTrayTitle('offline');
      }
    },
  });

  updateTrayTitle('starting...');
  createTray();

  // Start gateway (non-blocking - UI will show and connect when ready)
  gatewayManager.start().catch((err) => {
    console.error('[main] Gateway start failed:', err);
    updateTrayTitle('offline');
  });

  createWindow();
  setupAutoUpdater();

  ipcMain.on('dock-bounce', (_event, type: 'critical' | 'informational') => {
    if (app.dock) {
      app.dock.bounce(type);
    }
  });
  ipcMain.on('notify', (_event, payload: { title?: string; body?: string } | undefined) => {
    const title = payload?.title?.trim() || 'dorabot';
    const body = payload?.body?.trim() || '';
    if (!body) return;
    showAppNotification(title, body);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  showWindow();
});

app.on('before-quit', () => {
  isQuitting = true;
  gatewayManager?.stop();
});
