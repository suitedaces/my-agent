import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { getPage, type BrowserConfig } from '../browser/manager.js';
import {
  browserStatus,
  browserStart,
  browserStop,
  browserOpen,
  browserNavigatePage,
  browserSnapshot,
  browserScreenshot,
  browserClick,
  browserClickAt,
  browserDrag,
  browserType,
  browserFill,
  browserFillForm,
  browserSelect,
  browserPress,
  browserPressKey,
  browserHover,
  browserUploadFile,
  browserHandleDialog,
  browserWait,
  browserWaitForText,
  browserListPages,
  browserSelectPage,
  browserNewPage,
  browserCloseTab,
  browserClosePage,
  browserCookies,
  browserEvaluate,
  browserEvaluateScript,
  browserListConsoleMessages,
  browserGetConsoleMessage,
  browserListNetworkRequests,
  browserGetNetworkRequest,
  browserPdf,
  browserScroll,
  acquireBrowserMutex,
} from '../browser/actions.js';

// browser config loaded at runtime, set by gateway/startup
let browserConfig: BrowserConfig = {};

export function setBrowserConfig(config: BrowserConfig) {
  browserConfig = config;
}

const browserActions = [
  'status',
  'start',
  'stop',
  'open',
  'navigate',
  'navigate_page',
  'snapshot',
  'take_snapshot',
  'screenshot',
  'take_screenshot',
  'click',
  'click_at',
  'drag',
  'type',
  'fill',
  'fill_form',
  'select',
  'press',
  'press_key',
  'hover',
  'upload_file',
  'handle_dialog',
  'wait',
  'wait_for',
  'tabs',
  'list_pages',
  'select_page',
  'new_page',
  'close_tab',
  'close_page',
  'cookies',
  'evaluate',
  'evaluate_script',
  'list_console_messages',
  'get_console_message',
  'list_network_requests',
  'get_network_request',
  'pdf',
  'scroll',
] as const;

export const browserTool = tool(
  'browser',
  'Browser automation tool. Supports input, navigation, snapshots, screenshots, script evaluation, console/network inspection. Recommended flow: open/new_page -> take_snapshot -> interact with includeSnapshot=true (click/fill/select/press_key/hover/scroll return updated snapshot in same response, saving a round-trip). Only call take_snapshot separately for initial page load or after open/navigate/navigate_page. Use wait_for(text) instead of wait(timeMs) when possible.',
  {
    action: z.enum(browserActions),

    // Generic element refs
    uid: z.string().optional().describe('Element uid from take_snapshot (alias: ref)'),
    ref: z.string().optional().describe('Alias for uid'),
    from_uid: z.string().optional().describe('Source element uid/ref for drag'),
    from_ref: z.string().optional().describe('Alias for from_uid'),
    to_uid: z.string().optional().describe('Target element uid/ref for drag'),
    to_ref: z.string().optional().describe('Alias for to_uid'),

    // Navigation/page
    url: z.string().optional().describe('Target URL for open/new_page/navigate_page(type=url)'),
    pageId: z.number().optional().describe('Page ID from list_pages'),
    targetIndex: z.number().optional().describe('Legacy alias for pageId (close_tab)'),
    background: z.boolean().optional().describe('Open new page in background'),
    bringToFront: z.boolean().optional().describe('Bring selected page to front'),
    type: z.enum(['url', 'back', 'forward', 'reload']).optional().describe('navigate_page type'),
    timeout: z.number().optional().describe('Timeout in milliseconds (0 means default)'),
    ignoreCache: z.boolean().optional().describe('Ignore cache on reload (navigate_page)'),
    handleBeforeUnload: z.enum(['accept', 'decline']).optional().describe('How to handle beforeunload dialogs'),
    initScript: z.string().optional().describe('Script injected for the next navigation (navigate_page)'),

    // Input/form
    x: z.number().optional().describe('X coordinate for click_at'),
    y: z.number().optional().describe('Y coordinate for click_at'),
    dblClick: z.boolean().optional().describe('Double click when true'),
    includeSnapshot: z.boolean().optional().describe('Include snapshot after action when true'),
    text: z.string().optional().describe('Text for type/wait_for (legacy fill alias)'),
    value: z.string().optional().describe('Value for fill'),
    submit: z.boolean().optional().describe('Press Enter after type'),
    key: z.string().optional().describe('Key combo, e.g. Enter, Control+A'),
    values: z.array(z.string()).optional().describe('Values for select action'),
    fields: z
      .array(z.object({ ref: z.string(), value: z.string() }))
      .optional()
      .describe('Legacy fill_form payload: [{ref, value}]'),
    elements: z
      .array(
        z.object({
          uid: z.string().optional(),
          ref: z.string().optional(),
          value: z.string(),
        }),
      )
      .optional()
      .describe('fill_form payload: [{uid|ref, value}]'),
    filePath: z.string().optional().describe('File path for upload_file, take_snapshot, and take_screenshot'),
    dialogAction: z.enum(['accept', 'dismiss']).optional().describe('Action for handle_dialog'),
    promptText: z.string().optional().describe('Prompt text for dialog accept'),

    // Snapshot/screenshot
    verbose: z.boolean().optional().describe('Verbose snapshot mode'),
    interactive: z.boolean().optional().describe('Interactive-only snapshot mode'),
    selector: z.string().optional().describe('CSS scope for snapshot/wait'),
    format: z.enum(['png', 'jpeg', 'webp']).optional().describe('Screenshot format'),
    quality: z.number().min(0).max(100).optional().describe('Screenshot quality for jpeg/webp'),
    fullPage: z.boolean().optional().describe('Capture full-page screenshot'),

    // Scroll
    deltaX: z.number().optional().describe('Horizontal scroll pixels (positive=right). Default 0.'),
    deltaY: z.number().optional().describe('Vertical scroll pixels (positive=down). Default 300. Use negative to scroll up.'),

    // Wait
    timeMs: z.number().optional().describe('Time to wait in ms (legacy wait action)'),
    waitUrl: z.string().optional().describe('URL matcher to wait for (legacy wait action)'),

    // Cookies
    cookieAction: z.string().optional().describe('Cookie action: get, set, clear'),
    cookieName: z.string().optional().describe('Cookie name'),
    cookieValue: z.string().optional().describe('Cookie value'),
    cookieUrl: z.string().optional().describe('Cookie URL scope'),

    // Script eval
    fn: z.string().optional().describe('Legacy alias for function'),
    function: z.string().optional().describe('JavaScript function declaration for evaluate_script'),
    args: z
      .array(
        z.object({
          uid: z.string().optional(),
          ref: z.string().optional(),
        }),
      )
      .optional()
      .describe('Optional evaluate_script args as uids/refs'),

    // Console/network
    msgid: z.number().optional().describe('Console message ID for get_console_message'),
    reqid: z.number().optional().describe('Network request ID for get_network_request'),
    pageSize: z.number().int().positive().optional().describe('Pagination size for list_* actions'),
    pageIdx: z.number().int().min(0).optional().describe('Pagination index (0-based) for list_* actions'),
    types: z.array(z.string()).optional().describe('Console message type filter'),
    includePreservedMessages: z.boolean().optional().describe('Include preserved console messages over last navigations'),
    resourceTypes: z.array(z.string()).optional().describe('Network resource type filter'),
    includePreservedRequests: z.boolean().optional().describe('Include preserved network requests over last navigations'),
    requestFilePath: z.string().optional().describe('Output file for request body'),
    responseFilePath: z.string().optional().describe('Output file for response body'),

    // Legacy pdf alias
    path: z.string().optional().describe('Legacy alias for PDF output path'),
  },
  async (args) => {
    const fail = (text: string) => ({
      content: [{ type: 'text' as const, text: `Error: ${text}` }],
      isError: true,
    });

    const uid = args.uid || args.ref;
    const fromUid = args.from_uid || args.from_ref;
    const toUid = args.to_uid || args.to_ref;

    const releaseMutex = await acquireBrowserMutex();
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
          if (!args.url) return fail('url required');
          result = await browserOpen(browserConfig, args.url, args.timeout, args.includeSnapshot);
          break;

        case 'navigate':
          if (!args.url) return fail('url required');
          result = await browserOpen(browserConfig, args.url, args.timeout, args.includeSnapshot);
          break;

        case 'navigate_page':
          result = await browserNavigatePage({
            type: args.type,
            url: args.url,
            timeout: args.timeout,
            ignoreCache: args.ignoreCache,
            handleBeforeUnload: args.handleBeforeUnload,
            initScript: args.initScript,
            includeSnapshot: args.includeSnapshot,
          });
          break;

        case 'snapshot':
        case 'take_snapshot':
          result = await browserSnapshot(browserConfig, {
            interactive: args.interactive,
            selector: args.selector,
            verbose: args.verbose,
            filePath: args.filePath,
          });
          break;

        case 'screenshot':
        case 'take_screenshot':
          result = await browserScreenshot(browserConfig, {
            fullPage: args.fullPage,
            ref: uid,
            format: args.format,
            quality: args.quality,
            filePath: args.filePath,
          });
          break;

        case 'click':
          if (!uid) return fail('uid/ref required');
          result = await browserClick(uid, {
            dblClick: args.dblClick,
            includeSnapshot: args.includeSnapshot,
          });
          break;

        case 'click_at':
          if (args.x === undefined || args.y === undefined) return fail('x and y required');
          result = await browserClickAt(args.x, args.y, {
            dblClick: args.dblClick,
            includeSnapshot: args.includeSnapshot,
          });
          break;

        case 'drag':
          if (!fromUid || !toUid) return fail('from_uid/from_ref and to_uid/to_ref required');
          result = await browserDrag(fromUid, toUid, {
            includeSnapshot: args.includeSnapshot,
          });
          break;

        case 'type': {
          const text = args.text ?? args.value;
          if (!uid || text === undefined) return fail('uid/ref and text/value required');
          result = await browserType(uid, text, args.submit, args.includeSnapshot);
          break;
        }

        case 'fill': {
          const value = args.value ?? args.text;
          if (!uid || value === undefined) return fail('uid/ref and value/text required');
          result = await browserFill(uid, value, args.includeSnapshot);
          break;
        }

        case 'fill_form': {
          const elements = args.elements?.map(e => ({
            uid: e.uid || e.ref,
            value: e.value,
          })) || args.fields?.map(f => ({ uid: f.ref, value: f.value }));

          if (!elements || elements.length === 0) return fail('elements or fields required');
          if (elements.some(e => !e.uid)) return fail('each fill_form element must include uid/ref');

          result = await browserFillForm(
            elements.map(e => ({ uid: e.uid!, value: e.value })),
            args.includeSnapshot,
          );
          break;
        }

        case 'select':
          if (!uid || !args.values || args.values.length === 0) return fail('uid/ref and values required');
          result = await browserSelect(uid, args.values, args.includeSnapshot);
          break;

        case 'press':
          if (!args.key) return fail('key required');
          result = await browserPress(args.key);
          break;

        case 'press_key':
          if (!args.key) return fail('key required');
          result = await browserPressKey(args.key, args.includeSnapshot);
          break;

        case 'hover':
          if (!uid) return fail('uid/ref required');
          result = await browserHover(uid, args.includeSnapshot);
          break;

        case 'upload_file':
          if (!uid || !args.filePath) return fail('uid/ref and filePath required');
          result = await browserUploadFile(uid, args.filePath, args.includeSnapshot);
          break;

        case 'handle_dialog':
          if (!args.dialogAction) return fail('dialogAction required (accept|dismiss)');
          result = await browserHandleDialog(args.dialogAction, args.promptText, args.timeout);
          break;

        case 'wait':
          result = await browserWait({
            timeMs: args.timeMs,
            selector: args.selector,
            url: args.waitUrl || args.url,
          });
          break;

        case 'wait_for':
          if (!args.text) return fail('text required');
          result = await browserWaitForText(args.text, args.timeout);
          break;

        case 'tabs':
        case 'list_pages':
          result = await browserListPages();
          break;

        case 'select_page':
          if (args.pageId === undefined) return fail('pageId required');
          result = await browserSelectPage(args.pageId, args.bringToFront);
          break;

        case 'new_page':
          if (!args.url) return fail('url required');
          result = await browserNewPage(browserConfig, args.url, args.background, args.timeout);
          break;

        case 'close_tab':
          result = await browserCloseTab(args.targetIndex);
          break;

        case 'close_page': {
          const pageId = args.pageId ?? args.targetIndex;
          if (pageId === undefined) return fail('pageId required');
          result = await browserClosePage(pageId);
          break;
        }

        case 'cookies':
          if (!args.cookieAction) return fail('cookieAction required (get|set|clear)');
          result = await browserCookies(args.cookieAction, {
            name: args.cookieName,
            value: args.cookieValue,
            url: args.cookieUrl,
          });
          break;

        case 'evaluate': {
          const fn = args.fn || args.function;
          if (!fn) return fail('fn/function required');
          result = await browserEvaluate(fn);
          break;
        }

        case 'evaluate_script': {
          const fn = args.function || args.fn;
          if (!fn) return fail('function/fn required');
          result = await browserEvaluateScript(fn, args.args);
          break;
        }

        case 'list_console_messages':
          result = await browserListConsoleMessages({
            pageSize: args.pageSize,
            pageIdx: args.pageIdx,
            types: args.types,
            includePreservedMessages: args.includePreservedMessages,
          });
          break;

        case 'get_console_message':
          if (args.msgid === undefined) return fail('msgid required');
          result = await browserGetConsoleMessage(args.msgid);
          break;

        case 'list_network_requests':
          result = await browserListNetworkRequests({
            pageSize: args.pageSize,
            pageIdx: args.pageIdx,
            resourceTypes: args.resourceTypes,
            includePreservedRequests: args.includePreservedRequests,
          });
          break;

        case 'get_network_request':
          result = await browserGetNetworkRequest(args.reqid, {
            requestFilePath: args.requestFilePath,
            responseFilePath: args.responseFilePath,
          });
          break;

        case 'pdf':
          result = await browserPdf(args.path || args.filePath);
          break;

        case 'scroll':
          result = await browserScroll({
            uid,
            deltaX: args.deltaX,
            deltaY: args.deltaY,
            includeSnapshot: args.includeSnapshot,
          });
          break;

        default:
          return fail(`Unknown action: ${args.action}`);
      }

      // append current page url so frontend can show it in the address bar
      if (!result.isError) {
        try {
          const page = getPage();
          if (page) result.text += `\n[page: ${page.url()}]`;
        } catch {}
      }

      const content: any[] = [{ type: 'text' as const, text: result.text }];
      if (result.image) {
        content.push({
          type: 'image' as const,
          data: result.image,
          mimeType: result.mimeType || 'image/png',
        });
      }

      return {
        content,
        ...(result.isError ? { isError: true } : {}),
        ...(result.structured ? { structuredContent: result.structured } : {}),
      };
    } catch (e: any) {
      return {
        content: [{ type: 'text' as const, text: `Browser error: ${e.message}` }],
        isError: true,
      };
    } finally {
      releaseMutex();
    }
  },
);
