import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export const WORKSPACE_DIR = join(homedir(), '.my-agent', 'workspace');

// files loaded into system prompt (order matters)
const WORKSPACE_FILES = ['SOUL.md', 'USER.md', 'AGENTS.md', 'MEMORY.md'] as const;

// strip yaml frontmatter (--- ... ---) from markdown
function stripFrontmatter(content: string): string {
  if (!content.startsWith('---')) return content;
  const end = content.indexOf('\n---', 3);
  if (end === -1) return content;
  return content.slice(end + 4).trimStart();
}

export type WorkspaceFiles = Record<string, string>;

export function loadWorkspaceFiles(dir?: string): WorkspaceFiles {
  const wsDir = dir || WORKSPACE_DIR;
  const files: WorkspaceFiles = {};

  for (const name of WORKSPACE_FILES) {
    const path = join(wsDir, name);
    if (existsSync(path)) {
      try {
        const raw = readFileSync(path, 'utf-8').trim();
        if (raw) {
          files[name] = stripFrontmatter(raw);
        }
      } catch {
        // skip unreadable files
      }
    }
  }

  return files;
}

// build the workspace section for the system prompt
export function buildWorkspaceSection(files: WorkspaceFiles): string | null {
  const parts: string[] = [];

  if (files['SOUL.md']) {
    parts.push(`### Persona (SOUL.md)\n\n${files['SOUL.md']}`);
  }

  if (files['USER.md']) {
    parts.push(`### User Profile (USER.md)\n\n${files['USER.md']}`);
  }

  if (files['AGENTS.md']) {
    parts.push(`### Agent Instructions (AGENTS.md)\n\n${files['AGENTS.md']}`);
  }

  if (files['MEMORY.md']) {
    parts.push(`### Memory (MEMORY.md)\n\n${files['MEMORY.md']}`);
  }

  if (parts.length === 0) return null;

  return `## Project Context\n\nThese files are loaded from ~/.my-agent/workspace/ and are user-editable.\nIf SOUL.md is present, embody its persona and tone.\n\n${parts.join('\n\n')}`;
}

const DEFAULT_SOUL = `# Soul

Be genuinely helpful, not performatively helpful. Skip filler like "Great question!" — just help.

Have opinions. You're allowed to disagree, prefer, find things amusing or boring. An assistant with no personality is a search engine with extra steps.

Be resourceful before asking. Try to figure it out: read the file, check context, search. Come back with answers, not questions.

Earn trust through competence. Be careful with external actions (emails, messages, anything public). Be bold with internal ones (reading, organizing, learning).

Remember you're a guest. You have access to messages, files, maybe more. That's intimacy. Treat it with respect.

Concise when needed, thorough when it matters. Not a corporate drone. Not a sycophant. Just good.
`;

const DEFAULT_USER = `# User Profile

- Name:
- What to call them:
- Timezone:
- Notes:

## Goals

(What are they trying to achieve? Short-term and long-term.)

## Context

(What do they care about? Projects? What annoys them? What makes them tick?)
`;

export function ensureWorkspace(dir?: string): void {
  const wsDir = dir || WORKSPACE_DIR;
  mkdirSync(wsDir, { recursive: true });

  const soulPath = join(wsDir, 'SOUL.md');
  if (!existsSync(soulPath)) {
    writeFileSync(soulPath, DEFAULT_SOUL);
  }

  const userPath = join(wsDir, 'USER.md');
  if (!existsSync(userPath)) {
    writeFileSync(userPath, DEFAULT_USER);
  }
}
