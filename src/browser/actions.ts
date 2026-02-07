import type { Page } from 'playwright-core';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureBrowser, closeBrowser, isRunning, getPage, getContext, setActivePage, type BrowserConfig } from './manager.js';
import { generateSnapshot, resolveRef, clearRefs } from './refs.js';

type ActionResult = {
  text: string;
  isError?: boolean;
};

function ok(text: string): ActionResult {
  return { text };
}

function err(text: string): ActionResult {
  return { text, isError: true };
}

// status
export async function browserStatus(): Promise<ActionResult> {
  if (!isRunning()) return ok('Browser: not running');
  const page = getPage()!;
  try {
    const title = await page.title();
    const url = page.url();
    return ok(`Browser: running\nURL: ${url}\nTitle: ${title}`);
  } catch {
    return ok('Browser: running (page unresponsive)');
  }
}

// start
export async function browserStart(config: BrowserConfig): Promise<ActionResult> {
  if (isRunning()) return ok('Browser already running');
  await ensureBrowser(config);
  return ok('Browser started');
}

// stop
export async function browserStop(): Promise<ActionResult> {
  if (!isRunning()) return ok('Browser not running');
  await closeBrowser();
  clearRefs();
  return ok('Browser stopped');
}

// open / navigate
export async function browserOpen(config: BrowserConfig, url: string): Promise<ActionResult> {
  const page = await ensureBrowser(config);
  clearRefs();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  const title = await page.title();
  return ok(`Navigated to: ${url}\nTitle: ${title}`);
}

// snapshot
export async function browserSnapshot(config: BrowserConfig, opts: { interactive?: boolean; selector?: string } = {}): Promise<ActionResult> {
  const page = await ensureBrowser(config);
  const result = await generateSnapshot(page, {
    interactive: opts.interactive ?? true,
    selector: opts.selector,
  });
  return ok(result);
}

// screenshot
export async function browserScreenshot(config: BrowserConfig, opts: { fullPage?: boolean; ref?: string } = {}): Promise<ActionResult> {
  const page = await ensureBrowser(config);

  const outPath = join(tmpdir(), `browser-screenshot-${Date.now()}.png`);

  if (opts.ref) {
    const locator = resolveRef(opts.ref);
    if (!locator) return err(`Ref ${opts.ref} not found. Run snapshot first.`);
    await locator.screenshot({ path: outPath });
  } else {
    await page.screenshot({ path: outPath, fullPage: opts.fullPage });
  }

  return ok(`Screenshot saved: ${outPath}`);
}

// click
export async function browserClick(ref: string): Promise<ActionResult> {
  const locator = resolveRef(ref);
  if (!locator) return err(`Ref ${ref} not found. Run snapshot first.`);
  await locator.click({ timeout: 10_000 });
  clearRefs(); // page may have changed
  return ok(`Clicked ${ref}`);
}

// type (appends text)
export async function browserType(ref: string, text: string, submit?: boolean): Promise<ActionResult> {
  const locator = resolveRef(ref);
  if (!locator) return err(`Ref ${ref} not found. Run snapshot first.`);
  await locator.pressSequentially(text, { delay: 30 });
  if (submit) {
    await locator.press('Enter');
  }
  return ok(`Typed into ${ref}`);
}

// fill (clear + type)
export async function browserFill(ref: string, text: string): Promise<ActionResult> {
  const locator = resolveRef(ref);
  if (!locator) return err(`Ref ${ref} not found. Run snapshot first.`);
  await locator.fill(text);
  return ok(`Filled ${ref}`);
}

// fill_form (multiple fields)
export async function browserFillForm(fields: { ref: string; value: string }[]): Promise<ActionResult> {
  const results: string[] = [];
  for (const field of fields) {
    const locator = resolveRef(field.ref);
    if (!locator) {
      results.push(`${field.ref}: NOT FOUND`);
      continue;
    }
    await locator.fill(field.value);
    results.push(`${field.ref}: filled`);
  }
  return ok(results.join('\n'));
}

// select
export async function browserSelect(ref: string, values: string[]): Promise<ActionResult> {
  const locator = resolveRef(ref);
  if (!locator) return err(`Ref ${ref} not found. Run snapshot first.`);
  await locator.selectOption(values);
  return ok(`Selected ${values.join(', ')} in ${ref}`);
}

// press key
export async function browserPress(key: string): Promise<ActionResult> {
  const page = getPage();
  if (!page) return err('Browser not running');
  await page.keyboard.press(key);
  return ok(`Pressed ${key}`);
}

// hover
export async function browserHover(ref: string): Promise<ActionResult> {
  const locator = resolveRef(ref);
  if (!locator) return err(`Ref ${ref} not found. Run snapshot first.`);
  await locator.hover();
  return ok(`Hovered ${ref}`);
}

// wait
export async function browserWait(opts: { timeMs?: number; selector?: string; url?: string }): Promise<ActionResult> {
  const page = getPage();
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

// tabs
export async function browserTabs(): Promise<ActionResult> {
  const ctx = getContext();
  if (!ctx) return err('Browser not running');
  const pages = ctx.pages();
  if (pages.length === 0) return ok('No tabs open');

  const current = getPage();
  const lines = pages.map((p, i) => {
    const marker = p === current ? ' (active)' : '';
    return `${i}: ${p.url()}${marker}`;
  });
  return ok(lines.join('\n'));
}

// close_tab
export async function browserCloseTab(targetIndex?: number): Promise<ActionResult> {
  const ctx = getContext();
  if (!ctx) return err('Browser not running');
  const pages = ctx.pages();

  if (targetIndex !== undefined) {
    if (targetIndex < 0 || targetIndex >= pages.length) return err(`Tab ${targetIndex} not found`);
    await pages[targetIndex].close();
    // switch to another tab if we closed the active one
    if (pages[targetIndex] === getPage()) {
      const remaining = ctx.pages();
      if (remaining.length > 0) {
        setActivePage(remaining[0]);
      }
    }
  } else {
    const page = getPage();
    if (!page) return err('No active tab');
    await page.close();
    const remaining = ctx.pages();
    if (remaining.length > 0) {
      setActivePage(remaining[0]);
    }
  }

  clearRefs();
  return ok('Tab closed');
}

// cookies
export async function browserCookies(action: string, opts: { name?: string; value?: string; url?: string } = {}): Promise<ActionResult> {
  const ctx = getContext();
  if (!ctx) return err('Browser not running');

  switch (action) {
    case 'get': {
      const cookies = await ctx.cookies(opts.url ? [opts.url] : []);
      if (cookies.length === 0) return ok('No cookies');
      const lines = cookies.map(c => `${c.name}=${c.value} (${c.domain})`);
      return ok(lines.join('\n'));
    }
    case 'set': {
      if (!opts.name || !opts.value) return err('name and value required');
      const page = getPage();
      const url = opts.url || page?.url() || 'http://localhost';
      const domain = new URL(url).hostname;
      await ctx.addCookies([{ name: opts.name, value: opts.value, domain, path: '/' }]);
      return ok(`Cookie ${opts.name} set`);
    }
    case 'clear': {
      await ctx.clearCookies();
      return ok('Cookies cleared');
    }
    default:
      return err(`Unknown cookie action: ${action}. Use get, set, or clear.`);
  }
}

// evaluate JS
export async function browserEvaluate(fn: string): Promise<ActionResult> {
  const page = getPage();
  if (!page) return err('Browser not running');
  try {
    const result = await page.evaluate(fn);
    return ok(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
  } catch (e: any) {
    return err(`Evaluate error: ${e.message}`);
  }
}

// pdf
export async function browserPdf(path?: string): Promise<ActionResult> {
  const page = getPage();
  if (!page) return err('Browser not running');
  const outPath = path || join(tmpdir(), `browser-pdf-${Date.now()}.pdf`);
  await page.pdf({ path: outPath });
  return ok(`PDF saved: ${outPath}`);
}
