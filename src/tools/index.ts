import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { messageTool } from './messaging.js';
import { cronTools } from './cron.js';
import { screenshotTool } from './screenshot.js';
import { browserTool } from './browser.js';
import { boardTools } from './board.js';

export { messageTool, registerChannelHandler, getChannelHandler, type ChannelHandler } from './messaging.js';
export { setCronRunner, getCronRunner } from './cron.js';
export { screenshotTool } from './screenshot.js';
export { browserTool, setBrowserConfig } from './browser.js';
export { loadBoard, saveBoard, type Board, type BoardTask } from './board.js';

// all custom tools for this agent
const customTools = [
  messageTool,
  screenshotTool,
  browserTool,
  ...cronTools,
  ...boardTools,
];

export function createAgentMcpServer() {
  return createSdkMcpServer({
    name: 'dorabot-tools',
    version: '1.0.0',
    tools: customTools,
  });
}

export function getCustomToolNames(): string[] {
  return customTools.map(t => t.name);
}
