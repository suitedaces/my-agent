import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync } from 'node:fs';
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
const DEFAULT_PROFILE_DIR = join(homedir(), '.my-agent', 'browser', 'profile');

// singleton state
let browser: Browser | null = null;
let context: BrowserContext | null = null;
let activePage: Page | null = null;
let browserProcess: ReturnType<typeof import('node:child_process').spawn> | null = null;

// detect chromium-based browser on macOS
const BROWSER_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
];

export function findChromium(override?: string): string | null {
  if (override && existsSync(override)) return override;
  for (const p of BROWSER_PATHS) {
    if (existsSync(p)) return p;
  }
  return null;
}

export async function launchBrowser(config: BrowserConfig = {}): Promise<void> {
  if (browser) return; // already running

  const port = config.cdpPort || DEFAULT_CDP_PORT;
  const profileDir = config.profileDir || DEFAULT_PROFILE_DIR;
  const execPath = findChromium(config.executablePath);

  mkdirSync(profileDir, { recursive: true });

  if (!execPath) {
    throw new Error('No Chromium-based browser found. Install Chrome, Brave, or Edge, or set browser.executablePath in config.');
  }

  // launch browser with remote debugging
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

  browserProcess = spawn(execPath, args, {
    stdio: 'ignore',
    detached: true,
  });
  browserProcess.unref();

  // wait for CDP to be ready
  const cdpUrl = `http://127.0.0.1:${port}`;
  await waitForCdp(cdpUrl, 10_000);

  // connect playwright
  browser = await chromium.connectOverCDP(cdpUrl);
  const contexts = browser.contexts();
  context = contexts[0] || await browser.newContext();
  const pages = context.pages();
  activePage = pages[0] || await context.newPage();
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
