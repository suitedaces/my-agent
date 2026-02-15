import type { ConsoleMessage, Dialog, Locator, Page, Request, Response } from 'playwright-core';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  ensureBrowser,
  closeBrowser,
  isRunning,
  getPage,
  getContext,
  setActivePage,
  type BrowserConfig,
} from './manager.js';
import { clearRefs, clearAllRefs, generateSnapshot, resolveRef, getRefEntry } from './refs.js';
import { constrainImageSize } from '../image-utils.js';

export type ActionResult = {
  text: string;
  isError?: boolean;
  image?: string; // raw base64 image data (no data: prefix)
  mimeType?: string;
  structured?: Record<string, unknown>;
};

type ConsoleEntry = {
  msgid: number;
  type: string;
  text: string;
  timestamp: string;
  location?: {
    url: string;
    lineNumber: number;
    columnNumber: number;
  };
};

type NetworkEntry = {
  reqid: number;
  url: string;
  method: string;
  resourceType: string;
  startedAt: string;
  finishedAt?: string;
  status?: number;
  statusText?: string;
  failureText?: string;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
};

type NetworkRecord = {
  entry: NetworkEntry;
  request: Request;
  response?: Response;
};

type PageRuntimeState = {
  listenersAttached: boolean;
  nextConsoleId: number;
  consoleMessages: ConsoleEntry[];
  preservedConsoleMessages: ConsoleEntry[][];
  consoleById: Map<number, ConsoleEntry>;
  nextRequestId: number;
  networkRequests: NetworkRecord[];
  preservedNetworkRequests: NetworkRecord[][];
  requestIdByRequest: Map<Request, number>;
  networkById: Map<number, NetworkRecord>;
  latestRequestId?: number;
};

type TraceMetrics = {
  ttfb: number | null;
  fcp: number | null;
  lcp: number | null;
  cls: number | null;
  domContentLoaded: number | null;
  loadEventEnd: number | null;
};

type TraceRecord = {
  insightSetId: string;
  filePath: string;
  startedAt: string;
  stoppedAt: string;
  durationMs: number;
  pageUrl: string;
  metrics: TraceMetrics;
};

const runtimeByPage = new WeakMap<Page, PageRuntimeState>();

// dialog tracking — one dialog at a time per page
let activeDialog: Dialog | null = null;

export function getActiveDialog(): Dialog | null {
  return activeDialog;
}

export function clearActiveDialog(): void {
  activeDialog = null;
}

// mutex — serialize all browser actions
let mutexLocked = false;
const mutexQueue: Array<() => void> = [];

export async function acquireBrowserMutex(): Promise<() => void> {
  if (!mutexLocked) {
    mutexLocked = true;
    return () => {
      const next = mutexQueue.shift();
      if (next) {
        next();
      } else {
        mutexLocked = false;
      }
    };
  }
  return new Promise(resolve => {
    mutexQueue.push(() => {
      resolve(() => {
        const next = mutexQueue.shift();
        if (next) {
          next();
        } else {
          mutexLocked = false;
        }
      });
    });
  });
}

let isTracing = false;
let traceStartTime = 0;
let traceStartUrl = '';
const traceRecords = new Map<string, TraceRecord>();
let latestTraceInsightSetId: string | null = null;

const NETWORK_CONDITIONS: Record<
  string,
  {
    offline: boolean;
    latency: number;
    downloadThroughput: number;
    uploadThroughput: number;
    connectionType?: string;
  }
> = {
  'Slow 3G': {
    offline: false,
    latency: 400,
    downloadThroughput: 500 * 1024 / 8,
    uploadThroughput: 500 * 1024 / 8,
    connectionType: 'cellular3g',
  },
  'Fast 3G': {
    offline: false,
    latency: 150,
    downloadThroughput: 1.6 * 1024 * 1024 / 8,
    uploadThroughput: 750 * 1024 / 8,
    connectionType: 'cellular3g',
  },
  'Slow 4G': {
    offline: false,
    latency: 100,
    downloadThroughput: 4 * 1024 * 1024 / 8,
    uploadThroughput: 3 * 1024 * 1024 / 8,
    connectionType: 'cellular4g',
  },
  'Fast 4G': {
    offline: false,
    latency: 40,
    downloadThroughput: 9 * 1024 * 1024 / 8,
    uploadThroughput: 9 * 1024 * 1024 / 8,
    connectionType: 'cellular4g',
  },
};

function ok(text: string): ActionResult {
  const dialogWarning = activeDialog
    ? `\n\n⚠ Open ${activeDialog.type()} dialog: "${activeDialog.message()}" — call handle_dialog before continuing.`
    : '';
  return { text: text + dialogWarning };
}

function err(text: string): ActionResult {
  return { text, isError: true };
}

function normalizeTimeout(timeout?: number): number | undefined {
  if (!timeout || timeout <= 0) return undefined;
  return timeout;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function preserveHistory<T>(history: T[][], current: T[], max = 3) {
  if (current.length === 0) return;
  history.unshift([...current]);
  while (history.length > max) {
    history.pop();
  }
  current.length = 0;
}

// ─── Wait for page to settle after an action ─────────────────────────
// Inspired by Chrome DevTools MCP's waitForEventsAfterAction pattern.
// Waits for network idle + no pending navigations before returning.
const DEFAULT_SETTLE_TIMEOUT = 5_000;

async function waitForEventsAfterAction(
  page: Page,
  action: () => Promise<unknown>,
  opts: { timeout?: number } = {},
): Promise<void> {
  const timeout = opts.timeout ?? DEFAULT_SETTLE_TIMEOUT;

  // Run action and wait for network to settle
  await Promise.race([
    (async () => {
      await action();
      // Brief pause to let any triggered navigations/XHR start
      await new Promise(r => setTimeout(r, 100));
      // Wait for load state — 'networkidle' waits until no connections for 500ms
      try {
        await page.waitForLoadState('networkidle', { timeout: timeout - 100 });
      } catch {
        // Timeout is fine — page might have persistent connections (websockets, SSE)
      }
    })(),
    new Promise(r => setTimeout(r, timeout)),
  ]);
}

// ─── Context state for appending to every response ───────────────────
// Shows active emulation state so the agent always knows the environment.

type ContextState = {
  url: string;
  title: string;
  networkConditions?: string;
  cpuThrottlingRate?: number;
  viewport?: { width: number; height: number };
  colorScheme?: string;
  userAgent?: string;
  geolocation?: { latitude: number; longitude: number };
  openPages?: number;
};

let activeEmulationState: {
  networkConditions?: string;
  cpuThrottlingRate?: number;
  colorScheme?: string;
  userAgent?: string;
  geolocation?: { latitude: number; longitude: number };
} = {};

function updateEmulationState(partial: Partial<typeof activeEmulationState>) {
  Object.assign(activeEmulationState, partial);
  // Clean up null/undefined/'No emulation' values
  if (activeEmulationState.networkConditions === 'No emulation') {
    delete activeEmulationState.networkConditions;
  }
  if (activeEmulationState.cpuThrottlingRate === 1) {
    delete activeEmulationState.cpuThrottlingRate;
  }
  if (activeEmulationState.colorScheme === 'auto') {
    delete activeEmulationState.colorScheme;
  }
}

async function getContextState(): Promise<ContextState | null> {
  const page = getPage();
  if (!page) return null;

  const ctx = getContext();
  let title = '';
  try { title = await page.title(); } catch { title = '(unavailable)'; }

  const viewport = page.viewportSize();

  const state: ContextState = {
    url: page.url(),
    title,
  };

  if (viewport) {
    state.viewport = viewport;
  }

  if (ctx) {
    state.openPages = ctx.pages().length;
  }

  // Merge in tracked emulation state
  if (activeEmulationState.networkConditions) {
    state.networkConditions = activeEmulationState.networkConditions;
  }
  if (activeEmulationState.cpuThrottlingRate && activeEmulationState.cpuThrottlingRate > 1) {
    state.cpuThrottlingRate = activeEmulationState.cpuThrottlingRate;
  }
  if (activeEmulationState.colorScheme) {
    state.colorScheme = activeEmulationState.colorScheme;
  }
  if (activeEmulationState.userAgent) {
    state.userAgent = activeEmulationState.userAgent;
  }
  if (activeEmulationState.geolocation) {
    state.geolocation = activeEmulationState.geolocation;
  }

  return state;
}

function formatContextSuffix(state: ContextState | null): string {
  if (!state) return '';
  const parts: string[] = [];

  // Only append emulation state if any is active
  if (state.networkConditions) parts.push(`Network: ${state.networkConditions}`);
  if (state.cpuThrottlingRate) parts.push(`CPU: ${state.cpuThrottlingRate}x slowdown`);
  if (state.colorScheme) parts.push(`Color scheme: ${state.colorScheme}`);
  if (state.userAgent) parts.push(`User agent: ${state.userAgent}`);
  if (state.geolocation) parts.push(`Geolocation: ${state.geolocation.latitude}, ${state.geolocation.longitude}`);

  if (parts.length === 0) return '';
  return `\n\n[Active emulation: ${parts.join(' | ')}]`;
}

function okWithContext(text: string, structured?: Record<string, unknown>): ActionResult {
  return { text, structured };
}

function ensureRuntime(page: Page): PageRuntimeState {
  const existing = runtimeByPage.get(page);
  if (existing) return existing;

  const state: PageRuntimeState = {
    listenersAttached: false,
    nextConsoleId: 1,
    consoleMessages: [],
    preservedConsoleMessages: [],
    consoleById: new Map(),
    nextRequestId: 1,
    networkRequests: [],
    preservedNetworkRequests: [],
    requestIdByRequest: new Map(),
    networkById: new Map(),
  };

  runtimeByPage.set(page, state);
  attachRuntimeListeners(page, state);
  return state;
}

function attachRuntimeListeners(page: Page, state: PageRuntimeState) {
  if (state.listenersAttached) return;
  state.listenersAttached = true;

  page.on('dialog', (dialog: Dialog) => {
    activeDialog = dialog;
  });

  page.on('framenavigated', frame => {
    if (frame !== page.mainFrame()) return;
    preserveHistory(state.preservedConsoleMessages, state.consoleMessages);
    preserveHistory(state.preservedNetworkRequests, state.networkRequests);
    clearRefs();
  });

  page.on('console', (msg: ConsoleMessage) => {
    const location = msg.location();
    const entry: ConsoleEntry = {
      msgid: state.nextConsoleId++,
      type: msg.type(),
      text: msg.text(),
      timestamp: new Date().toISOString(),
      location: {
        url: location.url,
        lineNumber: location.lineNumber,
        columnNumber: location.columnNumber,
      },
    };
    state.consoleMessages.push(entry);
    state.consoleById.set(entry.msgid, entry);
  });

  page.on('request', request => {
    const reqid = state.nextRequestId++;
    const entry: NetworkEntry = {
      reqid,
      url: request.url(),
      method: request.method(),
      resourceType: request.resourceType(),
      startedAt: new Date().toISOString(),
    };
    const record: NetworkRecord = {
      entry,
      request,
    };

    state.requestIdByRequest.set(request, reqid);
    state.networkRequests.push(record);
    state.networkById.set(reqid, record);
    state.latestRequestId = reqid;

    void request
      .allHeaders()
      .then(headers => {
        record.entry.requestHeaders = headers;
      })
      .catch(() => undefined);
  });

  page.on('response', response => {
    const request = response.request();
    const reqid = state.requestIdByRequest.get(request);
    if (!reqid) return;

    const record = state.networkById.get(reqid);
    if (!record) return;

    record.response = response;
    record.entry.status = response.status();
    record.entry.statusText = response.statusText();
    record.entry.finishedAt = new Date().toISOString();

    void response
      .allHeaders()
      .then(headers => {
        record.entry.responseHeaders = headers;
      })
      .catch(() => undefined);
  });

  page.on('requestfailed', request => {
    const reqid = state.requestIdByRequest.get(request);
    if (!reqid) return;

    const record = state.networkById.get(reqid);
    if (!record) return;

    record.entry.failureText = request.failure()?.errorText || 'request failed';
    record.entry.finishedAt = new Date().toISOString();
  });
}

async function appendSnapshotIfNeeded(includeSnapshot?: boolean): Promise<string> {
  if (!includeSnapshot) return '';
  const page = getPage();
  if (!page) return '';
  const snapshot = await generateSnapshot(page, { interactive: true });
  return `\n\nSnapshot:\n${snapshot}`;
}

function resolveUid(uidOrRef: string) {
  const locator = resolveRef(uidOrRef);
  if (!locator) {
    throw new Error(`Element ref/uid ${uidOrRef} not found. Run take_snapshot first.`);
  }
  return locator;
}

function safeJson(value: unknown): string {
  try {
    if (typeof value === 'string') return value;
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function paginate<T>(items: T[], pageIdx?: number, pageSize?: number): T[] {
  const idx = pageIdx ?? 0;
  if (idx < 0) return [];
  if (!pageSize || pageSize <= 0) {
    return idx === 0 ? items : [];
  }
  const start = idx * pageSize;
  const end = start + pageSize;
  return items.slice(start, end);
}

function truncate(value: string, max = 20_000): { value: string; truncated: boolean } {
  if (value.length <= max) {
    return { value, truncated: false };
  }
  return {
    value: `${value.slice(0, max)}\n... [truncated ${value.length - max} chars]`,
    truncated: true,
  };
}

function flattenedConsole(state: PageRuntimeState, includePreserved = false): ConsoleEntry[] {
  if (!includePreserved) return [...state.consoleMessages];
  const preserved = [...state.preservedConsoleMessages].reverse().flat();
  return [...preserved, ...state.consoleMessages];
}

function flattenedNetwork(state: PageRuntimeState, includePreserved = false): NetworkRecord[] {
  if (!includePreserved) return [...state.networkRequests];
  const preserved = [...state.preservedNetworkRequests].reverse().flat();
  return [...preserved, ...state.networkRequests];
}

function publicNetworkEntry(record: NetworkRecord) {
  const entry = record.entry;
  return {
    reqid: entry.reqid,
    url: entry.url,
    method: entry.method,
    resourceType: entry.resourceType,
    status: entry.status ?? null,
    statusText: entry.statusText ?? null,
    failureText: entry.failureText ?? null,
    startedAt: entry.startedAt,
    finishedAt: entry.finishedAt ?? null,
  };
}

async function getSelectedPage(): Promise<Page | null> {
  const page = getPage();
  if (!page) return null;
  ensureRuntime(page);
  return page;
}

async function collectTraceMetrics(page: Page): Promise<TraceMetrics> {
  try {
    const metrics = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const perf = performance as any;
      const nav = perf.getEntriesByType('navigation')[0] as { responseStart?: number; domContentLoadedEventEnd?: number; loadEventEnd?: number } | undefined;
      const paints = perf.getEntriesByType('paint') as Array<{ name: string; startTime: number }>;
      const fcp = paints.find((p: { name: string }) => p.name === 'first-contentful-paint')?.startTime ?? null;
      const lcpEntries = perf.getEntriesByType('largest-contentful-paint') as Array<{ startTime: number }>;
      const lcp = lcpEntries.length > 0 ? lcpEntries[lcpEntries.length - 1].startTime : null;
      const shifts = perf.getEntriesByType('layout-shift') as Array<{ value?: number; hadRecentInput?: boolean }>;
      const cls = shifts.reduce((sum: number, shift: { value?: number; hadRecentInput?: boolean }) => {
        if (shift.hadRecentInput) return sum;
        return sum + (shift.value || 0);
      }, 0);

      return {
        ttfb: nav?.responseStart ?? null,
        fcp,
        lcp,
        cls: Number.isFinite(cls) ? cls : null,
        domContentLoaded: nav?.domContentLoadedEventEnd ?? null,
        loadEventEnd: nav?.loadEventEnd ?? null,
      };
    });

    return metrics;
  } catch {
    return {
      ttfb: null,
      fcp: null,
      lcp: null,
      cls: null,
      domContentLoaded: null,
      loadEventEnd: null,
    };
  }
}

// status
export async function browserStatus(): Promise<ActionResult> {
  if (!isRunning()) return ok('Browser: not running');

  const page = getPage();
  const context = getContext();
  if (!page || !context) return ok('Browser: running (state unavailable)');

  const pages = context.pages();
  for (const p of pages) {
    ensureRuntime(p);
  }

  let title = '';
  try {
    title = await page.title();
  } catch {
    title = '(unavailable)';
  }

  const selectedPageId = pages.indexOf(page);
  const lines = [
    'Browser: running',
    `Selected Page: ${selectedPageId >= 0 ? selectedPageId : 'unknown'}`,
    `URL: ${page.url()}`,
    `Title: ${title}`,
    `Open Pages: ${pages.length}`,
  ];

  for (let i = 0; i < pages.length; i++) {
    const marker = i === selectedPageId ? ' (selected)' : '';
    lines.push(`- ${i}: ${pages[i].url()}${marker}`);
  }

  return ok(lines.join('\n'));
}

// start
export async function browserStart(config: BrowserConfig): Promise<ActionResult> {
  const page = await ensureBrowser(config);
  ensureRuntime(page);

  const context = getContext();
  if (context) {
    for (const p of context.pages()) {
      ensureRuntime(p);
    }
  }

  return ok('Browser started');
}

// stop
export async function browserStop(): Promise<ActionResult> {
  if (!isRunning()) return ok('Browser not running');
  await closeBrowser();
  clearAllRefs();
  activeEmulationState = {};
  isTracing = false;
  return ok('Browser stopped');
}

// open / navigate alias
export async function browserOpen(config: BrowserConfig, url: string, timeout?: number, includeSnapshot?: boolean): Promise<ActionResult> {
  const page = await ensureBrowser(config);
  ensureRuntime(page);
  clearRefs();

  await page.goto(url, {
    waitUntil: 'domcontentloaded',
    timeout: normalizeTimeout(timeout),
  });

  const title = await page.title().catch(() => '(unavailable)');
  const suffix = await appendSnapshotIfNeeded(includeSnapshot);
  return ok(`Navigated to: ${url}\nTitle: ${title}${suffix}`);
}

// take_snapshot
export async function browserSnapshot(
  config: BrowserConfig,
  opts: {
    interactive?: boolean;
    selector?: string;
    verbose?: boolean;
    filePath?: string;
  } = {},
): Promise<ActionResult> {
  const page = await ensureBrowser(config);
  ensureRuntime(page);

  const snapshot = await generateSnapshot(page, {
    interactive: opts.interactive ?? !opts.verbose,
    selector: opts.selector,
  });

  if (opts.filePath) {
    const out = resolve(opts.filePath);
    await writeFile(out, snapshot, 'utf-8');
    return ok(`Snapshot saved: ${out}`);
  }

  return ok(snapshot);
}

// take_screenshot
export async function browserScreenshot(
  config: BrowserConfig,
  opts: {
    fullPage?: boolean;
    ref?: string;
    format?: 'png' | 'jpeg' | 'webp';
    quality?: number;
    filePath?: string;
  } = {},
): Promise<ActionResult> {
  const page = await ensureBrowser(config);
  ensureRuntime(page);

  if (opts.ref && opts.fullPage) {
    return err('Cannot set both ref/uid and fullPage in take_screenshot.');
  }

  const format = opts.format ?? 'png';
  const screenshotType = (format === 'webp' ? 'png' : format) as 'png' | 'jpeg';
  const quality = screenshotType === 'png' ? undefined : opts.quality;

  let buffer: Buffer;
  if (opts.ref) {
    const locator = resolveRef(opts.ref);
    if (!locator) return err(`Ref/uid ${opts.ref} not found. Run take_snapshot first.`);
    buffer = await locator.screenshot({
      type: screenshotType,
      quality,
      timeout: 15_000,
    });
  } else {
    buffer = await page.screenshot({
      type: screenshotType,
      quality,
      fullPage: opts.fullPage,
    });
  }

  const resized = await constrainImageSize(buffer);

  const ext = screenshotType === 'jpeg' ? 'jpg' : screenshotType;
  const requestedName = opts.filePath
    ? opts.filePath.replace(/^.*[\\/]/, '')
    : `browser-screenshot-${Date.now()}.${ext}`;
  const out = join(tmpdir(), requestedName || `browser-screenshot-${Date.now()}.${ext}`);
  await writeFile(out, resized);

  const url = page.url();
  const title = await page.title().catch(() => '(unavailable)');
  const base64 = resized.toString('base64');
  const mimeType = screenshotType === 'jpeg' ? 'image/jpeg' : 'image/png';
  return {
    text: `Screenshot captured from: ${url} (${title})\nSaved screenshot path: ${out}`,
    image: base64,
    mimeType,
  };
}

// click
export async function browserClick(uid: string, opts: { dblClick?: boolean; includeSnapshot?: boolean } = {}): Promise<ActionResult> {
  const page = getPage();
  if (!page) return err('Browser not running');

  try {
    const locator = resolveUid(uid);
    await waitForEventsAfterAction(page, async () => {
      await locator.click({ clickCount: opts.dblClick ? 2 : 1, timeout: 10_000 });
    });
    clearRefs();
    const suffix = await appendSnapshotIfNeeded(opts.includeSnapshot);
    const ctxState = await getContextState();
    return ok(`${opts.dblClick ? 'Double clicked' : 'Clicked'} ${uid}${suffix}${formatContextSuffix(ctxState)}`);
  } catch (e) {
    return err(`Click failed for ${uid}: ${errorMessage(e)}`);
  }
}

// click_at
export async function browserClickAt(
  x: number,
  y: number,
  opts: { dblClick?: boolean; includeSnapshot?: boolean } = {},
): Promise<ActionResult> {
  const page = await getSelectedPage();
  if (!page) return err('Browser not running');

  await waitForEventsAfterAction(page, async () => {
    await page.mouse.click(x, y, { clickCount: opts.dblClick ? 2 : 1 });
  });
  clearRefs();

  const suffix = await appendSnapshotIfNeeded(opts.includeSnapshot);
  const ctxState = await getContextState();
  return ok(`${opts.dblClick ? 'Double clicked' : 'Clicked'} at (${x}, ${y})${suffix}${formatContextSuffix(ctxState)}`);
}

// drag
export async function browserDrag(
  fromUid: string,
  toUid: string,
  opts: { includeSnapshot?: boolean } = {},
): Promise<ActionResult> {
  const page = getPage();
  if (!page) return err('Browser not running');

  try {
    const from = resolveUid(fromUid);
    const to = resolveUid(toUid);
    await waitForEventsAfterAction(page, async () => {
      await from.dragTo(to, { timeout: 10_000 });
      await new Promise(resolve => setTimeout(resolve, 50));
    });

    const suffix = await appendSnapshotIfNeeded(opts.includeSnapshot);
    const ctxState = await getContextState();
    return ok(`Dragged ${fromUid} onto ${toUid}${suffix}${formatContextSuffix(ctxState)}`);
  } catch (e) {
    return err(`Drag failed: ${errorMessage(e)}`);
  }
}

// type (append text)
export async function browserType(
  uid: string,
  text: string,
  submit?: boolean,
  includeSnapshot?: boolean,
): Promise<ActionResult> {
  const page = getPage();
  if (!page) return err('Browser not running');

  try {
    const locator = resolveUid(uid);
    await waitForEventsAfterAction(page, async () => {
      await locator.pressSequentially(text, { delay: 25 });
      if (submit) {
        await locator.press('Enter');
      }
    });

    const suffix = await appendSnapshotIfNeeded(includeSnapshot);
    const ctxState = await getContextState();
    return ok(`Typed into ${uid}${submit ? ' and submitted' : ''}${suffix}${formatContextSuffix(ctxState)}`);
  } catch (e) {
    return err(`Type failed for ${uid}: ${errorMessage(e)}`);
  }
}

// fill (clear + type)
/**
 * For combobox/select elements, resolve the display text to the actual option value
 * by querying the DOM. The snapshot shows display text but selectOption needs the
 * real HTML value attribute.
 */
async function resolveSelectValue(locator: Locator, displayText: string): Promise<string> {
  try {
    const realValue = await locator.evaluate((el: any, text: any) => {
      if (el.tagName !== 'SELECT') return null;
      const options = el.options;
      for (let i = 0; i < options.length; i++) {
        const opt = options[i];
        if (opt.textContent?.trim() === text) return opt.value;
        if (opt.label?.trim() === text) return opt.value;
      }
      return null;
    }, displayText);
    return realValue ?? displayText;
  } catch {
    return displayText;
  }
}

async function fillElement(locator: Locator, value: string, isCombobox: boolean): Promise<void> {
  if (isCombobox) {
    // Resolve display text to real option value, then select
    const realValue = await resolveSelectValue(locator, value);
    try {
      await locator.selectOption(realValue);
    } catch {
      // Fallback: try with original value, then fill
      try {
        await locator.selectOption(value);
      } catch {
        await locator.fill(value);
      }
    }
  } else {
    try {
      await locator.fill(value);
    } catch {
      await locator.selectOption(value);
    }
  }
}

export async function browserFill(uid: string, value: string, includeSnapshot?: boolean): Promise<ActionResult> {
  const page = getPage();
  if (!page) return err('Browser not running');

  try {
    const locator = resolveUid(uid);
    const refEntry = getRefEntry(uid);
    const isCombobox = refEntry?.role === 'combobox';

    await waitForEventsAfterAction(page, async () => {
      await fillElement(locator, value, !!isCombobox);
    });

    const suffix = await appendSnapshotIfNeeded(includeSnapshot);
    const ctxState = await getContextState();
    return ok(`Filled ${uid}${suffix}${formatContextSuffix(ctxState)}`);
  } catch (e) {
    return err(`Fill failed for ${uid}: ${errorMessage(e)}`);
  }
}

// fill_form
export async function browserFillForm(
  elements: { uid: string; value: string }[],
  includeSnapshot?: boolean,
): Promise<ActionResult> {
  const page = getPage();
  if (!page) return err('Browser not running');

  const results: string[] = [];

  for (const element of elements) {
    try {
      const locator = resolveUid(element.uid);
      const refEntry = getRefEntry(element.uid);
      const isCombobox = refEntry?.role === 'combobox';

      await waitForEventsAfterAction(page, async () => {
        await fillElement(locator, element.value, !!isCombobox);
      });
      results.push(`${element.uid}: filled`);
    } catch (e) {
      results.push(`${element.uid}: failed (${errorMessage(e)})`);
    }
  }

  const suffix = await appendSnapshotIfNeeded(includeSnapshot);
  const ctxState = await getContextState();
  return ok(`${results.join('\n')}${suffix}${formatContextSuffix(ctxState)}`);
}

// upload_file
export async function browserUploadFile(
  uid: string,
  filePath: string,
  includeSnapshot?: boolean,
): Promise<ActionResult> {
  const page = await getSelectedPage();
  if (!page) return err('Browser not running');

  const locator = resolveRef(uid);
  if (!locator) return err(`Ref/uid ${uid} not found. Run take_snapshot first.`);

  const absolutePath = resolve(filePath);

  try {
    await waitForEventsAfterAction(page, async () => {
      try {
        await locator.setInputFiles(absolutePath);
      } catch {
        const [fileChooser] = await Promise.all([
          page.waitForEvent('filechooser', { timeout: 3_000 }),
          locator.click({ timeout: 3_000 }),
        ]);
        await fileChooser.setFiles(absolutePath);
      }
    });

    const suffix = await appendSnapshotIfNeeded(includeSnapshot);
    return ok(`File uploaded from ${absolutePath}.${suffix}`);
  } catch (e) {
    return err(`Upload failed for ${uid}: ${errorMessage(e)}`);
  }
}

// select
export async function browserSelect(uid: string, values: string[], includeSnapshot?: boolean): Promise<ActionResult> {
  const page = getPage();
  if (!page) return err('Browser not running');

  try {
    const locator = resolveUid(uid);
    await waitForEventsAfterAction(page, async () => {
      await locator.selectOption(values);
    });

    const suffix = await appendSnapshotIfNeeded(includeSnapshot);
    const ctxState = await getContextState();
    return ok(`Selected ${values.join(', ')} in ${uid}${suffix}${formatContextSuffix(ctxState)}`);
  } catch (e) {
    return err(`Select failed for ${uid}: ${errorMessage(e)}`);
  }
}

// press key
export async function browserPressKey(key: string, includeSnapshot?: boolean): Promise<ActionResult> {
  const page = await getSelectedPage();
  if (!page) return err('Browser not running');

  await waitForEventsAfterAction(page, async () => {
    await page.keyboard.press(key);
  });
  const suffix = await appendSnapshotIfNeeded(includeSnapshot);
  const ctxState = await getContextState();
  return ok(`Pressed ${key}${suffix}${formatContextSuffix(ctxState)}`);
}

// backward-compatible alias
export async function browserPress(key: string): Promise<ActionResult> {
  return browserPressKey(key, false);
}

// hover
export async function browserHover(uid: string, includeSnapshot?: boolean): Promise<ActionResult> {
  const page = getPage();
  if (!page) return err('Browser not running');

  try {
    const locator = resolveUid(uid);
    await waitForEventsAfterAction(page, async () => {
      await locator.hover({ timeout: 10_000 });
    });

    const suffix = await appendSnapshotIfNeeded(includeSnapshot);
    const ctxState = await getContextState();
    return ok(`Hovered ${uid}${suffix}${formatContextSuffix(ctxState)}`);
  } catch (e) {
    return err(`Hover failed for ${uid}: ${errorMessage(e)}`);
  }
}

// scroll
export async function browserScroll(opts: {
  uid?: string;
  deltaX?: number;
  deltaY?: number;
  includeSnapshot?: boolean;
} = {}): Promise<ActionResult> {
  const page = getPage();
  if (!page) return err('Browser not running');

  const deltaX = opts.deltaX ?? 0;
  const deltaY = opts.deltaY ?? 300; // default: scroll down one viewport-ish chunk

  try {
    if (opts.uid) {
      // Scroll a specific element into view, then scroll within it
      const locator = resolveUid(opts.uid);
      await locator.scrollIntoViewIfNeeded({ timeout: 5_000 });
      if (deltaX !== 0 || deltaY !== 0) {
        await locator.evaluate((el: any, deltas: any) => {
          el.scrollBy(deltas.x, deltas.y);
        }, { x: deltaX, y: deltaY });
      }
    } else {
      // Scroll the page using mouse wheel (works with lazy-loaded content)
      await page.mouse.wheel(deltaX, deltaY);
    }

    // Small delay for lazy content to load
    await page.waitForTimeout(300);

    const suffix = await appendSnapshotIfNeeded(opts.includeSnapshot);
    const direction = deltaY > 0 ? 'down' : deltaY < 0 ? 'up' : deltaX > 0 ? 'right' : 'left';
    const target = opts.uid ? `element ${opts.uid}` : 'page';
    return ok(`Scrolled ${target} ${direction} by (${deltaX}, ${deltaY})${suffix}`);
  } catch (e) {
    return err(`Scroll failed: ${errorMessage(e)}`);
  }
}

// handle_dialog (for upcoming dialog)
export async function browserHandleDialog(
  action: 'accept' | 'dismiss',
  promptText?: string,
  timeout?: number,
): Promise<ActionResult> {
  const page = await getSelectedPage();
  if (!page) return err('Browser not running');

  try {
    // use tracked dialog if available, otherwise wait for one
    const dialog = activeDialog ?? await page.waitForEvent('dialog', {
      timeout: normalizeTimeout(timeout) ?? 5_000,
    });

    if (action === 'accept') {
      await dialog.accept(promptText);
    } else {
      await dialog.dismiss();
    }

    activeDialog = null;
    return ok(`Handled dialog (${dialog.type()}) with action=${action}. Message: ${dialog.message()}`);
  } catch (e) {
    return err(`No dialog handled: ${errorMessage(e)}`);
  }
}

// wait (legacy)
export async function browserWait(opts: { timeMs?: number; selector?: string; url?: string }): Promise<ActionResult> {
  const page = await getSelectedPage();
  if (!page) return err('Browser not running');

  if (opts.timeMs) {
    await page.waitForTimeout(opts.timeMs);
  }
  if (opts.selector) {
    await page.waitForSelector(opts.selector, { timeout: 15_000 });
  }
  if (opts.url) {
    await page.waitForURL(opts.url, { timeout: 15_000 });
  }

  return ok('Wait complete');
}

// wait_for text
export async function browserWaitForText(text: string, timeout?: number): Promise<ActionResult> {
  const page = await getSelectedPage();
  if (!page) return err('Browser not running');

  const effectiveTimeout = normalizeTimeout(timeout) ?? 15_000;

  try {
    // Search all frames (main page + iframes) for the text
    const frames = page.frames();
    const locators = frames.flatMap(frame => [
      frame.getByText(text).first(),
      frame.locator(`text=${text}`).first(),
    ]);

    // Race all locators - first one to find the text wins
    await Promise.any(
      locators.map(loc => loc.waitFor({ timeout: effectiveTimeout }))
    );
    const suffix = await appendSnapshotIfNeeded(true);
    return ok(`Element with text "${text}" found.${suffix}`);
  } catch (e) {
    return err(`Timed out waiting for text "${text}": ${errorMessage(e)}`);
  }
}

async function compactPageList(): Promise<string> {
  const ctx = getContext();
  if (!ctx) return '';
  const pages = ctx.pages();
  const current = getPage();
  const lines = await Promise.all(
    pages.map(async (page, idx) => {
      const sel = page === current ? ' [selected]' : '';
      const title = await page.title().catch(() => '');
      return `  ${idx}: ${page.url()}${title ? ` (${title})` : ''}${sel}`;
    }),
  );
  return `\nPages:\n${lines.join('\n')}`;
}

// list_pages
export async function browserListPages(): Promise<ActionResult> {
  const ctx = getContext();
  if (!ctx) return err('Browser not running');

  const pages = ctx.pages();
  const current = getPage();
  for (const page of pages) {
    ensureRuntime(page);
  }

  const payload = await Promise.all(
    pages.map(async (page, idx) => {
      const title = await page.title().catch(() => '(unavailable)');
      return {
        pageId: idx,
        selected: page === current,
        url: page.url(),
        title,
      };
    }),
  );

  return ok(safeJson({ pages: payload }));
}

// backward-compatible alias
export async function browserTabs(): Promise<ActionResult> {
  return browserListPages();
}

// select_page
export async function browserSelectPage(pageId: number, bringToFront?: boolean): Promise<ActionResult> {
  const ctx = getContext();
  if (!ctx) return err('Browser not running');

  const pages = ctx.pages();
  if (pageId < 0 || pageId >= pages.length) {
    const list = await compactPageList();
    return err(`Page ${pageId} not found${list}`);
  }

  const page = pages[pageId];
  setActivePage(page);
  ensureRuntime(page);

  if (bringToFront) {
    await page.bringToFront().catch(() => undefined);
  }

  clearRefs();
  const list = await compactPageList();
  return ok(`Selected page ${pageId}: ${page.url()}${list}`);
}

// new_page
export async function browserNewPage(
  config: BrowserConfig,
  url: string,
  background?: boolean,
  timeout?: number,
): Promise<ActionResult> {
  await ensureBrowser(config);
  const ctx = getContext();
  if (!ctx) return err('Browser not running');

  const page = await ctx.newPage();
  ensureRuntime(page);

  await page.goto(url, {
    timeout: normalizeTimeout(timeout),
    waitUntil: 'domcontentloaded',
  });

  if (!background) {
    setActivePage(page);
    await page.bringToFront().catch(() => undefined);
  }

  clearRefs();
  const pageId = ctx.pages().indexOf(page);
  const list = await compactPageList();
  return ok(`New page opened (pageId=${pageId}, background=${!!background}): ${url}${list}`);
}

// close_page
export async function browserClosePage(pageId?: number): Promise<ActionResult> {
  const ctx = getContext();
  if (!ctx) return err('Browser not running');

  const pages = ctx.pages();
  if (pages.length <= 1) {
    return err('Cannot close the last open page.');
  }

  let target: Page | null = null;
  if (pageId !== undefined) {
    if (pageId < 0 || pageId >= pages.length) {
      return err(`Page ${pageId} not found`);
    }
    target = pages[pageId];
  } else {
    target = getPage();
  }

  if (!target) {
    return err('No active page to close');
  }

  const wasSelected = target === getPage();
  const closingUrl = target.url();
  await target.close();

  const remaining = ctx.pages();
  if (wasSelected && remaining.length > 0) {
    setActivePage(remaining[0]);
  }

  clearRefs();
  const list = await compactPageList();
  return ok(`Closed page: ${closingUrl}${list}`);
}

// backward-compatible alias
export async function browserCloseTab(targetIndex?: number): Promise<ActionResult> {
  return browserClosePage(targetIndex);
}

// navigate_page
export async function browserNavigatePage(opts: {
  type?: 'url' | 'back' | 'forward' | 'reload';
  url?: string;
  timeout?: number;
  ignoreCache?: boolean;
  handleBeforeUnload?: 'accept' | 'decline';
  initScript?: string;
  includeSnapshot?: boolean;
}): Promise<ActionResult> {
  const page = await getSelectedPage();
  if (!page) return err('Browser not running');

  if (!opts.type && !opts.url) {
    return err('Either url or type is required.');
  }

  const type = opts.type || 'url';
  const timeout = normalizeTimeout(opts.timeout);
  const handleBeforeUnload = opts.handleBeforeUnload ?? 'accept';

  let cdpSession: any | null = null;
  const getCdpSession = async () => {
    if (!cdpSession) {
      cdpSession = await page.context().newCDPSession(page);
    }
    return cdpSession;
  };

  let scriptIdentifier: string | undefined;
  let usedAddInitScript = false;
  if (opts.initScript) {
    try {
      const session = await getCdpSession();
      const result = await session.send('Page.addScriptToEvaluateOnNewDocument', {
        source: opts.initScript,
      });
      scriptIdentifier = result?.identifier;
    } catch {
      // Fallback: addInitScript persists for the page lifetime and cannot be removed.
      // This is a known limitation - the script will run on every subsequent navigation.
      await page.addInitScript(opts.initScript);
      usedAddInitScript = true;
    }
  }

  const dialogHandler = (dialog: Dialog) => {
    if (dialog.type() === 'beforeunload') {
      if (handleBeforeUnload === 'accept') {
        void dialog.accept();
      } else {
        void dialog.dismiss();
      }
      return;
    }

    // Do not leave unexpected dialogs hanging.
    void dialog.dismiss().catch(() => undefined);
  };

  page.on('dialog', dialogHandler);

  try {
    switch (type) {
      case 'url':
        if (!opts.url) {
          return err('url is required for navigate_page with type=url.');
        }
        await page.goto(opts.url, { timeout, waitUntil: 'domcontentloaded' });
        break;

      case 'back': {
        const res = await page.goBack({ timeout, waitUntil: 'domcontentloaded' });
        if (!res) return err('Cannot navigate back: no history entry.');
        break;
      }

      case 'forward': {
        const res = await page.goForward({ timeout, waitUntil: 'domcontentloaded' });
        if (!res) return err('Cannot navigate forward: no history entry.');
        break;
      }

      case 'reload':
        if (opts.ignoreCache) {
          const session = await getCdpSession();
          await session.send('Page.reload', { ignoreCache: true });
          await page.waitForLoadState('domcontentloaded', { timeout });
        } else {
          await page.reload({ timeout, waitUntil: 'domcontentloaded' });
        }
        break;

      default:
        return err(`Unknown navigate_page type: ${type}`);
    }

    clearRefs();
    const suffix = await appendSnapshotIfNeeded(opts.includeSnapshot);
    const initScriptWarning = usedAddInitScript ? '\nNote: initScript was added via fallback and will persist on this page.' : '';
    return ok(`Navigation complete (${type}). Current URL: ${page.url()}${initScriptWarning}${suffix}`);
  } catch (e) {
    return err(`Navigation failed: ${errorMessage(e)}`);
  } finally {
    page.off('dialog', dialogHandler);

    if (scriptIdentifier && cdpSession) {
      await cdpSession
        .send('Page.removeScriptToEvaluateOnNewDocument', { identifier: scriptIdentifier })
        .catch(() => undefined);
    }

    if (cdpSession) {
      await cdpSession.detach().catch(() => undefined);
    }
  }
}

// cookies
export async function browserCookies(
  action: string,
  opts: { name?: string; value?: string; url?: string } = {},
): Promise<ActionResult> {
  const ctx = getContext();
  if (!ctx) return err('Browser not running');

  switch (action) {
    case 'get': {
      const cookies = await ctx.cookies(opts.url ? [opts.url] : []);
      if (cookies.length === 0) return ok('No cookies');
      return ok(safeJson(cookies));
    }

    case 'set': {
      if (!opts.name || !opts.value) return err('name and value are required');
      const page = getPage();
      const cookieUrl = opts.url || page?.url() || 'http://localhost';
      await ctx.addCookies([
        {
          name: opts.name,
          value: opts.value,
          url: cookieUrl,
        },
      ]);
      return ok(`Cookie ${opts.name} set for ${cookieUrl}`);
    }

    case 'clear': {
      await ctx.clearCookies();
      return ok('Cookies cleared');
    }

    default:
      return err(`Unknown cookie action: ${action}. Use get, set, or clear.`);
  }
}

// evaluate_script
export async function browserEvaluateScript(
  functionDeclaration: string,
  args?: Array<{ uid?: string; ref?: string }>,
): Promise<ActionResult> {
  const page = await getSelectedPage();
  if (!page) return err('Browser not running');

  const handles: any[] = [];
  let fnHandle: any;

  try {
    for (const arg of args || []) {
      const uid = arg.uid || arg.ref;
      if (!uid) {
        return err('Each evaluate_script arg must include uid or ref');
      }

      const locator = resolveRef(uid);
      if (!locator) {
        return err(`Ref/uid ${uid} not found. Run take_snapshot first.`);
      }

      const handle = await locator.elementHandle();
      if (!handle) {
        return err(`Element handle for ${uid} is no longer available. Re-run take_snapshot.`);
      }

      handles.push(handle);
    }

    fnHandle = await page.evaluateHandle(`(${functionDeclaration})`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const evalFn = page.evaluate as any;
    const result = await evalFn.call(
      page,
      async (fn: unknown, ...els: unknown[]) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const callable = fn as any;
        return await callable(...els);
      },
      fnHandle,
      ...handles,
    );

    return ok(`Script ran on page and returned:\n\
\`\`\`json\n${safeJson(result)}\n\`\`\``);
  } catch (e) {
    return err(`Evaluate error: ${errorMessage(e)}`);
  } finally {
    if (fnHandle) {
      await fnHandle.dispose().catch(() => undefined);
    }
    await Promise.all(handles.map(handle => handle.dispose().catch(() => undefined)));
  }
}

// backward-compatible alias
export async function browserEvaluate(fn: string): Promise<ActionResult> {
  return browserEvaluateScript(fn);
}

// list_console_messages
export async function browserListConsoleMessages(opts: {
  pageSize?: number;
  pageIdx?: number;
  types?: string[];
  includePreservedMessages?: boolean;
} = {}): Promise<ActionResult> {
  const page = await getSelectedPage();
  if (!page) return err('Browser not running');

  const state = ensureRuntime(page);
  let messages = flattenedConsole(state, !!opts.includePreservedMessages);

  if (opts.types && opts.types.length > 0) {
    messages = messages.filter(msg => opts.types!.includes(msg.type));
  }

  const paged = paginate(messages, opts.pageIdx, opts.pageSize);

  return ok(
    safeJson({
      total: messages.length,
      pageIdx: opts.pageIdx ?? 0,
      pageSize: opts.pageSize ?? messages.length,
      messages: paged,
    }),
  );
}

// get_console_message
export async function browserGetConsoleMessage(msgid: number): Promise<ActionResult> {
  const page = await getSelectedPage();
  if (!page) return err('Browser not running');

  const state = ensureRuntime(page);
  const entry = state.consoleById.get(msgid);
  if (!entry) {
    return err(`Console message ${msgid} not found`);
  }

  return ok(safeJson(entry));
}

// list_network_requests
export async function browserListNetworkRequests(opts: {
  pageSize?: number;
  pageIdx?: number;
  resourceTypes?: string[];
  includePreservedRequests?: boolean;
} = {}): Promise<ActionResult> {
  const page = await getSelectedPage();
  if (!page) return err('Browser not running');

  const state = ensureRuntime(page);
  let records = flattenedNetwork(state, !!opts.includePreservedRequests);

  if (opts.resourceTypes && opts.resourceTypes.length > 0) {
    records = records.filter(record => opts.resourceTypes!.includes(record.entry.resourceType));
  }

  const publicEntries = records.map(publicNetworkEntry);
  const paged = paginate(publicEntries, opts.pageIdx, opts.pageSize);

  return ok(
    safeJson({
      total: publicEntries.length,
      pageIdx: opts.pageIdx ?? 0,
      pageSize: opts.pageSize ?? publicEntries.length,
      selectedReqId: state.latestRequestId ?? null,
      requests: paged,
    }),
  );
}

function shouldTreatAsText(contentType: string | undefined): boolean {
  if (!contentType) return false;
  const value = contentType.toLowerCase();
  return (
    value.startsWith('text/') ||
    value.includes('json') ||
    value.includes('xml') ||
    value.includes('javascript') ||
    value.includes('html') ||
    value.includes('x-www-form-urlencoded')
  );
}

// get_network_request
export async function browserGetNetworkRequest(
  reqid?: number,
  opts: { requestFilePath?: string; responseFilePath?: string } = {},
): Promise<ActionResult> {
  const page = await getSelectedPage();
  if (!page) return err('Browser not running');

  const state = ensureRuntime(page);
  const targetReqId = reqid ?? state.latestRequestId;

  if (!targetReqId) {
    return err('No network request selected. Call list_network_requests first or provide reqid.');
  }

  const record = state.networkById.get(targetReqId);
  if (!record) {
    return err(`Network request ${targetReqId} not found`);
  }

  const requestBodyRaw = record.request.postData() ?? '';
  const requestBody = truncate(requestBodyRaw, 20_000);

  let responseBodyBuffer: Buffer | null = null;
  if (record.response) {
    responseBodyBuffer = await record.response.body().catch(() => null);
    if (!record.entry.responseHeaders) {
      record.entry.responseHeaders = await record.response.allHeaders().catch(() => undefined);
    }
  }

  const payload: Record<string, unknown> = {
    request: {
      ...publicNetworkEntry(record),
      requestHeaders: record.entry.requestHeaders || {},
      responseHeaders: record.entry.responseHeaders || {},
    },
  };

  if (requestBodyRaw.length > 0) {
    if (opts.requestFilePath) {
      const out = resolve(opts.requestFilePath);
      await writeFile(out, requestBodyRaw, 'utf-8');
      payload.requestBodyFile = out;
    } else {
      payload.requestBody = {
        encoding: 'utf8',
        truncated: requestBody.truncated,
        data: requestBody.value,
      };
    }
  }

  if (responseBodyBuffer) {
    if (opts.responseFilePath) {
      const out = resolve(opts.responseFilePath);
      await writeFile(out, responseBodyBuffer);
      payload.responseBodyFile = out;
    } else {
      const contentType =
        record.entry.responseHeaders?.['content-type'] ||
        record.entry.responseHeaders?.['Content-Type'];

      if (shouldTreatAsText(contentType)) {
        const textBody = truncate(responseBodyBuffer.toString('utf-8'), 20_000);
        payload.responseBody = {
          encoding: 'utf8',
          truncated: textBody.truncated,
          data: textBody.value,
        };
      } else {
        const base64Body = truncate(responseBodyBuffer.toString('base64'), 20_000);
        payload.responseBody = {
          encoding: 'base64',
          truncated: base64Body.truncated,
          data: base64Body.value,
        };
      }
    }
  }

  return ok(safeJson(payload));
}

// emulate
export async function browserEmulate(opts: {
  networkConditions?: string;
  cpuThrottlingRate?: number;
  geolocation?: { latitude: number; longitude: number } | null;
  userAgent?: string | null;
  colorScheme?: 'dark' | 'light' | 'auto';
  viewport?: {
    width: number;
    height: number;
    deviceScaleFactor?: number;
    isMobile?: boolean;
    hasTouch?: boolean;
    isLandscape?: boolean;
  } | null;
}): Promise<ActionResult> {
  const page = await getSelectedPage();
  if (!page) return err('Browser not running');

  const summary: string[] = [];
  const client = await page.context().newCDPSession(page);

  try {
    if (opts.networkConditions) {
      await client.send('Network.enable');

      if (opts.networkConditions === 'No emulation') {
        await client.send('Network.emulateNetworkConditions', {
          offline: false,
          latency: 0,
          downloadThroughput: -1,
          uploadThroughput: -1,
        });
        summary.push('Network emulation disabled');
        updateEmulationState({ networkConditions: undefined });
      } else if (opts.networkConditions === 'Offline') {
        await client.send('Network.emulateNetworkConditions', {
          offline: true,
          latency: 0,
          downloadThroughput: 0,
          uploadThroughput: 0,
        });
        summary.push('Network emulation: Offline');
        updateEmulationState({ networkConditions: 'Offline' });
      } else {
        const preset = NETWORK_CONDITIONS[opts.networkConditions];
        if (!preset) {
          return err(`Unknown networkConditions: ${opts.networkConditions}`);
        }

        await client.send('Network.emulateNetworkConditions', preset as any);
        summary.push(`Network emulation: ${opts.networkConditions}`);
        updateEmulationState({ networkConditions: opts.networkConditions });
      }
    }

    if (opts.cpuThrottlingRate !== undefined) {
      await client.send('Emulation.setCPUThrottlingRate', {
        rate: opts.cpuThrottlingRate,
      });
      summary.push(`CPU throttling rate: ${opts.cpuThrottlingRate}`);
      updateEmulationState({ cpuThrottlingRate: opts.cpuThrottlingRate });
    }

    if (opts.geolocation !== undefined) {
      if (opts.geolocation === null) {
        await client.send('Emulation.clearGeolocationOverride');
        summary.push('Geolocation override cleared');
        updateEmulationState({ geolocation: undefined });
      } else {
        await client.send('Emulation.setGeolocationOverride', {
          latitude: opts.geolocation.latitude,
          longitude: opts.geolocation.longitude,
          accuracy: 1,
        });
        summary.push(`Geolocation set: ${opts.geolocation.latitude}, ${opts.geolocation.longitude}`);
        updateEmulationState({ geolocation: opts.geolocation });
      }
    }

    if (opts.userAgent !== undefined) {
      if (opts.userAgent === null) {
        // Clear the override entirely by setting empty string, which restores browser default
        await client.send('Emulation.setUserAgentOverride', { userAgent: '' });
        summary.push('User agent reset to browser default');
        updateEmulationState({ userAgent: undefined });
      } else {
        await client.send('Emulation.setUserAgentOverride', { userAgent: opts.userAgent });
        summary.push(`User agent set: ${opts.userAgent}`);
        updateEmulationState({ userAgent: opts.userAgent });
      }
    }

    if (opts.colorScheme) {
      if (opts.colorScheme === 'auto') {
        await client.send('Emulation.setEmulatedMedia', { features: [] });
        summary.push('Color scheme emulation reset');
        updateEmulationState({ colorScheme: undefined });
      } else {
        await client.send('Emulation.setEmulatedMedia', {
          features: [{ name: 'prefers-color-scheme', value: opts.colorScheme }],
        });
        summary.push(`Color scheme emulation: ${opts.colorScheme}`);
        updateEmulationState({ colorScheme: opts.colorScheme });
      }
    }

    if (opts.viewport !== undefined) {
      if (opts.viewport === null) {
        await client.send('Emulation.clearDeviceMetricsOverride');
        summary.push('Viewport override cleared');
      } else {
        const width = opts.viewport.width;
        const height = opts.viewport.height;
        const deviceScaleFactor = opts.viewport.deviceScaleFactor ?? 1;
        const mobile = opts.viewport.isMobile ?? false;

        await client.send('Emulation.setDeviceMetricsOverride', {
          width,
          height,
          deviceScaleFactor,
          mobile,
          screenOrientation: opts.viewport.isLandscape
            ? { type: 'landscapePrimary', angle: 90 }
            : { type: 'portraitPrimary', angle: 0 },
        });

        await page.setViewportSize({ width, height }).catch(() => undefined);
        summary.push(
          `Viewport set: ${width}x${height}, dpr=${deviceScaleFactor}, mobile=${mobile}, touch=${opts.viewport.hasTouch ?? false}`,
        );
      }
    }

    if (summary.length === 0) {
      return ok('No emulation changes requested.');
    }

    return ok(summary.join('\n'));
  } catch (e) {
    return err(`Emulation failed: ${errorMessage(e)}`);
  } finally {
    await client.detach().catch(() => undefined);
  }
}

// resize_page
export async function browserResizePage(width: number, height: number): Promise<ActionResult> {
  const page = await getSelectedPage();
  if (!page) return err('Browser not running');

  await page.setViewportSize({ width, height });
  return ok(`Resized page viewport to ${width}x${height}`);
}

// performance_start_trace
export async function browserPerformanceStartTrace(opts: {
  reload: boolean;
  autoStop: boolean;
  filePath?: string;
}): Promise<ActionResult> {
  const context = getContext();
  const page = getPage();
  if (!context || !page) return err('Browser not running');

  if (isTracing) {
    return err('A performance trace is already running. Stop it with performance_stop_trace.');
  }

  await context.tracing.start({ screenshots: true, snapshots: true });
  isTracing = true;
  traceStartTime = Date.now();
  traceStartUrl = page.url();

  if (opts.reload) {
    await page.reload({ waitUntil: 'load' }).catch(() => undefined);
  }

  if (opts.autoStop) {
    await new Promise(resolve => setTimeout(resolve, 5_000));
    return browserPerformanceStopTrace({ filePath: opts.filePath });
  }

  return ok('Performance trace started. Run performance_stop_trace to stop recording.');
}

// performance_stop_trace
export async function browserPerformanceStopTrace(opts: { filePath?: string } = {}): Promise<ActionResult> {
  const context = getContext();
  const page = getPage();
  if (!context || !page) return err('Browser not running');

  if (!isTracing) {
    return err('No active performance trace is running.');
  }

  const outPath = resolve(opts.filePath || join(tmpdir(), `browser-trace-${Date.now()}.zip`));

  try {
    await context.tracing.stop({ path: outPath });
  } finally {
    isTracing = false;
  }

  const stoppedAtMs = Date.now();
  const metrics = await collectTraceMetrics(page);
  const insightSetId = `trace-${stoppedAtMs}`;

  const record: TraceRecord = {
    insightSetId,
    filePath: outPath,
    startedAt: new Date(traceStartTime).toISOString(),
    stoppedAt: new Date(stoppedAtMs).toISOString(),
    durationMs: Math.max(0, stoppedAtMs - traceStartTime),
    pageUrl: traceStartUrl || page.url(),
    metrics,
  };

  traceRecords.set(insightSetId, record);
  latestTraceInsightSetId = insightSetId;

  return ok(
    `Performance trace stopped.\nRaw trace saved: ${outPath}\nAvailable insightSetId: ${insightSetId}\nUse performance_analyze_insight with insightName: TraceSummary, NavigationTiming, or WebVitalsSnapshot.`,
  );
}

// performance_analyze_insight
export async function browserPerformanceAnalyzeInsight(
  insightSetId: string,
  insightName: string,
): Promise<ActionResult> {
  const resolvedInsightSetId = insightSetId || latestTraceInsightSetId;
  if (!resolvedInsightSetId) {
    return err('No recorded traces found. Start and stop a performance trace first.');
  }

  const record = traceRecords.get(resolvedInsightSetId);
  if (!record) {
    return err(`Insight set ${resolvedInsightSetId} not found.`);
  }

  const key = insightName.toLowerCase();
  let detail: Record<string, unknown>;

  if (key === 'tracesummary') {
    detail = {
      insightSetId: record.insightSetId,
      filePath: record.filePath,
      pageUrl: record.pageUrl,
      startedAt: record.startedAt,
      stoppedAt: record.stoppedAt,
      durationMs: record.durationMs,
    };
  } else if (key === 'navigationtiming') {
    detail = {
      ttfbMs: record.metrics.ttfb,
      domContentLoadedMs: record.metrics.domContentLoaded,
      loadEventEndMs: record.metrics.loadEventEnd,
    };
  } else if (key === 'webvitalssnapshot' || key.includes('lcp') || key.includes('cls') || key.includes('fcp')) {
    detail = {
      fcpMs: record.metrics.fcp,
      lcpMs: record.metrics.lcp,
      cls: record.metrics.cls,
    };
  } else {
    detail = {
      message: `Insight "${insightName}" is not directly supported by this Playwright-based analyzer.`,
      availableInsights: ['TraceSummary', 'NavigationTiming', 'WebVitalsSnapshot'],
      traceSummary: {
        durationMs: record.durationMs,
        pageUrl: record.pageUrl,
      },
      metrics: record.metrics,
    };
  }

  return ok(safeJson({ insightSetId: resolvedInsightSetId, insightName, detail }));
}

// pdf
export async function browserPdf(path?: string): Promise<ActionResult> {
  const page = getPage();
  if (!page) return err('Browser not running');

  const outPath = resolve(path || join(tmpdir(), `browser-pdf-${Date.now()}.pdf`));
  await page.pdf({ path: outPath });
  return ok(`PDF saved: ${outPath}`);
}
