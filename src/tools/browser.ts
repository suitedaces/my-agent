import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import type { BrowserConfig } from '../browser/manager.js';
import {
  browserStatus,
  browserStart,
  browserStop,
  browserOpen,
  browserSnapshot,
  browserScreenshot,
  browserClick,
  browserType,
  browserFill,
  browserFillForm,
  browserSelect,
  browserPress,
  browserHover,
  browserWait,
  browserTabs,
  browserCloseTab,
  browserCookies,
  browserEvaluate,
  browserPdf,
} from '../browser/actions.js';

// browser config loaded at runtime, set by gateway/startup
let browserConfig: BrowserConfig = {};

export function setBrowserConfig(config: BrowserConfig) {
  browserConfig = config;
}

export const browserTool = tool(
  'browser',
  'Control web browser. Actions: status, start, stop, open, snapshot, screenshot, click, type, fill, fill_form, select, press, hover, wait, tabs, close_tab, navigate, cookies, evaluate, pdf. Use snapshot to get element refs (e1, e2...), then use refs for click/type/fill. Refs invalidate after navigation — re-snapshot after clicking links.',
  {
    action: z.enum([
      'status', 'start', 'stop', 'open', 'snapshot', 'screenshot',
      'click', 'type', 'fill', 'fill_form', 'select', 'press', 'hover',
      'wait', 'tabs', 'close_tab', 'navigate', 'cookies', 'evaluate', 'pdf',
    ]),
    url: z.string().optional().describe('URL to navigate to (for open/navigate)'),
    ref: z.string().optional().describe('Element ref from snapshot (e.g. "e1")'),
    text: z.string().optional().describe('Text to type/fill'),
    submit: z.boolean().optional().describe('Press Enter after typing'),
    key: z.string().optional().describe('Key to press (e.g. "Enter", "Tab", "Escape")'),
    fullPage: z.boolean().optional().describe('Capture full page screenshot'),
    interactive: z.boolean().optional().describe('Show only interactive elements in snapshot (default true)'),
    selector: z.string().optional().describe('CSS selector to scope snapshot/wait'),
    values: z.array(z.string()).optional().describe('Values for select action'),
    fields: z.array(z.object({ ref: z.string(), value: z.string() })).optional().describe('Fields for fill_form: [{ref, value}]'),
    timeMs: z.number().optional().describe('Wait time in milliseconds'),
    waitUrl: z.string().optional().describe('URL pattern to wait for'),
    targetIndex: z.number().optional().describe('Tab index for close_tab'),
    cookieAction: z.string().optional().describe('Cookie sub-action: get, set, clear'),
    cookieName: z.string().optional().describe('Cookie name'),
    cookieValue: z.string().optional().describe('Cookie value'),
    cookieUrl: z.string().optional().describe('Cookie URL scope'),
    fn: z.string().optional().describe('JavaScript to evaluate in page context'),
    path: z.string().optional().describe('Output path for pdf'),
  },
  async (args) => {
    try {
      let result;

      switch (args.action) {
        case 'status':
          result = await browserStatus();
          break;

        case 'start':
          result = await browserStart(browserConfig);
          break;

        case 'stop':
          result = await browserStop();
          break;

        case 'open':
        case 'navigate':
          if (!args.url) return { content: [{ type: 'text' as const, text: 'Error: url required' }], isError: true };
          result = await browserOpen(browserConfig, args.url);
          break;

        case 'snapshot':
          result = await browserSnapshot(browserConfig, {
            interactive: args.interactive,
            selector: args.selector,
          });
          break;

        case 'screenshot':
          result = await browserScreenshot(browserConfig, {
            fullPage: args.fullPage,
            ref: args.ref,
          });
          break;

        case 'click':
          if (!args.ref) return { content: [{ type: 'text' as const, text: 'Error: ref required' }], isError: true };
          result = await browserClick(args.ref);
          break;

        case 'type':
          if (!args.ref || !args.text) return { content: [{ type: 'text' as const, text: 'Error: ref and text required' }], isError: true };
          result = await browserType(args.ref, args.text, args.submit);
          break;

        case 'fill':
          if (!args.ref || !args.text) return { content: [{ type: 'text' as const, text: 'Error: ref and text required' }], isError: true };
          result = await browserFill(args.ref, args.text);
          break;

        case 'fill_form':
          if (!args.fields || args.fields.length === 0) return { content: [{ type: 'text' as const, text: 'Error: fields required' }], isError: true };
          result = await browserFillForm(args.fields);
          break;

        case 'select':
          if (!args.ref || !args.values) return { content: [{ type: 'text' as const, text: 'Error: ref and values required' }], isError: true };
          result = await browserSelect(args.ref, args.values);
          break;

        case 'press':
          if (!args.key) return { content: [{ type: 'text' as const, text: 'Error: key required' }], isError: true };
          result = await browserPress(args.key);
          break;

        case 'hover':
          if (!args.ref) return { content: [{ type: 'text' as const, text: 'Error: ref required' }], isError: true };
          result = await browserHover(args.ref);
          break;

        case 'wait':
          result = await browserWait({
            timeMs: args.timeMs,
            selector: args.selector,
            url: args.waitUrl,
          });
          break;

        case 'tabs':
          result = await browserTabs();
          break;

        case 'close_tab':
          result = await browserCloseTab(args.targetIndex);
          break;

        case 'cookies':
          if (!args.cookieAction) return { content: [{ type: 'text' as const, text: 'Error: cookieAction required (get, set, clear)' }], isError: true };
          result = await browserCookies(args.cookieAction, {
            name: args.cookieName,
            value: args.cookieValue,
            url: args.cookieUrl,
          });
          break;

        case 'evaluate':
          if (!args.fn) return { content: [{ type: 'text' as const, text: 'Error: fn required' }], isError: true };
          result = await browserEvaluate(args.fn);
          break;

        case 'pdf':
          result = await browserPdf(args.path);
          break;

        default:
          return { content: [{ type: 'text' as const, text: `Unknown action: ${args.action}` }], isError: true };
      }

      return {
        content: [{ type: 'text' as const, text: result.text }],
        ...(result.isError ? { isError: true } : {}),
      };
    } catch (e: any) {
      return {
        content: [{ type: 'text' as const, text: `Browser error: ${e.message}` }],
        isError: true,
      };
    }
  }
);
