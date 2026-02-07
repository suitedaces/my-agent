import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const execFileAsync = promisify(execFile);

export const screenshotTool = tool(
  'screenshot',
  'Take a screenshot of the current macOS screen and save it to a file. Returns the file path.',
  {
    filename: z.string().optional().describe('Custom filename (without extension). Defaults to screenshot-<timestamp>'),
    display: z.number().optional().describe('Display number to capture (default: main display)'),
  },
  async (args) => {
    const name = args.filename || `screenshot-${Date.now()}`;
    const outPath = join(tmpdir(), `${name}.png`);

    try {
      const cmd = ['screencapture', '-x']; // -x = no sound
      if (args.display) {
        cmd.push('-D', String(args.display));
      }
      cmd.push(outPath);

      await execFileAsync(cmd[0], cmd.slice(1), { timeout: 10_000 });

      return {
        content: [{ type: 'text' as const, text: outPath }],
      };
    } catch (err: any) {
      return {
        content: [{ type: 'text' as const, text: `Screenshot failed: ${err.message}` }],
        isError: true,
      };
    }
  }
);
