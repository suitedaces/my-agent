import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { messageTool } from './messaging.js';
import { cronTools } from './cron.js';
import { screenshotTool } from './screenshot.js';
import { browserTool } from './browser.js';

export { messageTool, registerChannelHandler, getChannelHandler, type ChannelHandler } from './messaging.js';
export { setCronRunner, getCronRunner } from './cron.js';
export { screenshotTool } from './screenshot.js';
export { browserTool, setBrowserConfig } from './browser.js';

// all custom tools for this agent
const customTools = [
  messageTool,
  screenshotTool,
  browserTool,
  ...cronTools,
];

export function createAgentMcpServer() {
  return createSdkMcpServer({
    name: 'my-agent-tools',
    version: '1.0.0',
    tools: customTools,
  });
}

export function getCustomToolNames(): string[] {
  return customTools.map(t => t.name);
}
