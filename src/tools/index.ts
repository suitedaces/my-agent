import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { messageTool } from './messaging.js';

export { messageTool, registerChannelHandler, getChannelHandler, type ChannelHandler } from './messaging.js';

// all custom tools for this agent
const customTools = [
  messageTool,
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
