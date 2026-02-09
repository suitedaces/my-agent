import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const execFileAsync = promisify(execFile);

export type BrowserConfig = {
  enabled?: boolean;
  executablePath?: string;
  cdpPort?: number;
  profileDir?: string;
  headless?: boolean;
};

const DEFAULT_CDP_PORT = 19222;

// singleton state
let browser: Browser | null = null;
let context: BrowserContext | null = null;
let activePage: Page | null = null;
let browserProcess: ReturnType<typeof import('node:child_process').spawn> | null = null;

// browser executable → real macOS user data dir
const BROWSER_INFO: { exec: string; dataDir: string; appName: string }[] = [
  {
    exec: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    dataDir: join(homedir(), 'Library', 'Application Support', 'Google', 'Chrome'),
    appName: 'Google Chrome',
  },
  {
    exec: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    dataDir: join(homedir(), 'Library', 'Application Support', 'BraveSoftware', 'Brave-Browser'),
    appName: 'Brave Browser',
  },
  {
    exec: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    dataDir: join(homedir(), 'Library', 'Application Support', 'Microsoft Edge'),
    appName: 'Microsoft Edge',
  },
  {
    exec: '/Applications/Chromium.app/Contents/MacOS/Chromium',
    dataDir: join(homedir(), 'Library', 'Application Support', 'Chromium'),
    appName: 'Chromium',
  },
  {
    exec: '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    dataDir: join(homedir(), 'Library', 'Application Support', 'Google', 'Chrome Canary'),
    appName: 'Google Chrome Canary',
  },
];

export function findChromium(override?: string): { exec: string; dataDir: string; appName: string } | null {
  if (override && existsSync(override)) {
    // custom path — check if it matches a known browser for profile dir
    const known = BROWSER_INFO.find(b => b.exec === override);
    return known || { exec: override, dataDir: join(homedir(), 'Library', 'Application Support', 'Google', 'Chrome'), appName: 'Google Chrome' };
  }
  for (const b of BROWSER_INFO) {
    if (existsSync(b.exec)) return b;
  }
  return null;
}

// check if chrome already has CDP active via DevToolsActivePort file
function readDevToolsPort(dataDir: string): number | null {
  const portFile = join(dataDir, 'DevToolsActivePort');
  try {
    const content = readFileSync(portFile, 'utf-8');
    const port = parseInt(content.split('\n')[0], 10);
    return isNaN(port) ? null : port;
  } catch {
    return null;
  }
}

// check if a process matching the app name is running
async function isAppRunning(appName: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('pgrep', ['-f', appName]);
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

// gracefully quit a macOS app and wait for it to exit
async function quitApp(appName: string, timeoutMs = 5000): Promise<void> {
  try {
    await execFileAsync('osascript', ['-e', `tell application "${appName}" to quit`]);
  } catch {
    // app might not be running or not respond to osascript
  }
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!(await isAppRunning(appName))) return;
    await new Promise(r => setTimeout(r, 300));
  }
  // force kill as fallback
  try { await execFileAsync('pkill', ['-f', appName]); } catch {}
}

export async function launchBrowser(config: BrowserConfig = {}): Promise<void> {
  if (browser) return;

  const port = config.cdpPort || DEFAULT_CDP_PORT;
  const info = findChromium(config.executablePath);

  if (!info) {
    throw new Error('No Chromium-based browser found. Install Chrome, Brave, or Edge, or set browser.executablePath in config.');
  }

  const profileDir = config.profileDir || info.dataDir;

  // check if browser is already running with CDP
  const existingPort = readDevToolsPort(profileDir);
  if (existingPort) {
    try {
      const cdpUrl = `http://127.0.0.1:${existingPort}`;
      browser = await chromium.connectOverCDP(cdpUrl);
      const contexts = browser.contexts();
      context = contexts[0] || await browser.newContext();
      const pages = context.pages();
      activePage = pages[0] || await context.newPage();
      console.log(`[browser] connected to existing CDP on port ${existingPort}`);
      return;
    } catch {
      // stale port file, continue to launch
    }
  }

  // if browser is running without CDP, quit it first
  if (await isAppRunning(info.appName)) {
    console.log(`[browser] ${info.appName} running without CDP, restarting with remote debugging...`);
    await quitApp(info.appName);
  }

  const { spawn } = await import('node:child_process');
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
  ];

  if (config.headless) {
    args.push('--headless=new');
  }

  browserProcess = spawn(info.exec, args, {
    stdio: 'ignore',
    detached: true,
  });
  browserProcess.unref();

  const cdpUrl = `http://127.0.0.1:${port}`;
  await waitForCdp(cdpUrl, 10_000);

  browser = await chromium.connectOverCDP(cdpUrl);
  const contexts = browser.contexts();
  context = contexts[0] || await browser.newContext();
  const pages = context.pages();
  activePage = pages[0] || await context.newPage();
  console.log(`[browser] launched ${info.appName} with CDP on port ${port}, profile: ${profileDir}`);
}

export async function connectToExisting(config: BrowserConfig = {}): Promise<void> {
  if (browser) return;

  const port = config.cdpPort || DEFAULT_CDP_PORT;
  const cdpUrl = `http://127.0.0.1:${port}`;

  browser = await chromium.connectOverCDP(cdpUrl);
  const contexts = browser.contexts();
  context = contexts[0] || await browser.newContext();
  const pages = context.pages();
  activePage = pages[0] || await context.newPage();
}

export async function ensureBrowser(config: BrowserConfig = {}): Promise<Page> {
  if (activePage) {
    try {
      await activePage.title(); // check if still alive
      return activePage;
    } catch {
      // page died, reconnect
      browser = null;
      context = null;
      activePage = null;
    }
  }

  // try connecting to existing browser first
  const port = config.cdpPort || DEFAULT_CDP_PORT;
  try {
    await connectToExisting(config);
    return activePage!;
  } catch {
    // not running, launch it
  }

  await launchBrowser(config);
  return activePage!;
}

export function getPage(): Page | null {
  return activePage;
}

export function setActivePage(page: Page) {
  activePage = page;
}

export function getBrowser(): Browser | null {
  return browser;
}

export function getContext(): BrowserContext | null {
  return context;
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    try { await browser.close(); } catch {}
    browser = null;
    context = null;
    activePage = null;
  }
  if (browserProcess) {
    try { browserProcess.kill(); } catch {}
    browserProcess = null;
  }
}

export function isRunning(): boolean {
  return browser !== null && activePage !== null;
}

// wait for CDP endpoint to be reachable
async function waitForCdp(url: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  const versionUrl = `${url}/json/version`;

  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(versionUrl);
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise(r => setTimeout(r, 200));
  }

  throw new Error(`CDP not reachable at ${url} after ${timeoutMs}ms`);
}
