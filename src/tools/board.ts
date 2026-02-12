import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const BOARD_PATH = join(homedir(), '.dorabot', 'workspace', 'BOARD.md');

// ── Types ──

export type BoardTask = {
  id: string;
  title: string;
  description?: string;
  status: 'proposed' | 'approved' | 'in_progress' | 'done' | 'rejected';
  priority: 'high' | 'medium' | 'low';
  source: 'agent' | 'user';
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  result?: string;
  tags?: string[];
};

export type Board = {
  tasks: BoardTask[];
  lastPlanAt?: string;
  version: number;
};

// ── Board I/O ──

export function loadBoard(): Board {
  if (!existsSync(BOARD_PATH)) {
    return { tasks: [], version: 1 };
  }
  try {
    const raw = readFileSync(BOARD_PATH, 'utf-8');
    return parseBoard(raw);
  } catch {
    return { tasks: [], version: 1 };
  }
}

export function saveBoard(board: Board): void {
  const dir = join(homedir(), '.dorabot', 'workspace');
  mkdirSync(dir, { recursive: true });
  board.version = (board.version || 0) + 1;
  writeFileSync(BOARD_PATH, serializeBoard(board));
}

function nextId(board: Board): string {
  const ids = board.tasks.map(t => parseInt(t.id, 10)).filter(n => !isNaN(n));
  return String((ids.length > 0 ? Math.max(...ids) : 0) + 1);
}

// ── Markdown serialization ──
// Format: human-readable markdown that's also machine-parseable

function serializeBoard(board: Board): string {
  const lines: string[] = ['# Board', ''];
  if (board.lastPlanAt) {
    lines.push(`Last planned: ${board.lastPlanAt}`, '');
  }

  const columns: Record<string, BoardTask[]> = {
    proposed: [],
    approved: [],
    in_progress: [],
    done: [],
    rejected: [],
  };

  for (const task of board.tasks) {
    columns[task.status]?.push(task);
  }

  const columnLabels: Record<string, string> = {
    proposed: 'Proposed (awaiting approval)',
    approved: 'Approved (ready to execute)',
    in_progress: 'In Progress',
    done: 'Done',
    rejected: 'Rejected',
  };

  for (const [status, label] of Object.entries(columnLabels)) {
    const tasks = columns[status];
    if (!tasks || tasks.length === 0) continue;

    lines.push(`## ${label}`, '');
    for (const task of tasks) {
      const tags = task.tags?.length ? ` [${task.tags.join(', ')}]` : '';
      const priority = task.priority !== 'medium' ? ` (${task.priority})` : '';
      lines.push(`- **#${task.id}** ${task.title}${priority}${tags}`);
      if (task.description) {
        lines.push(`  ${task.description}`);
      }
      if (task.result) {
        lines.push(`  Result: ${task.result}`);
      }
      lines.push(`  source:${task.source} created:${task.createdAt} updated:${task.updatedAt}${task.completedAt ? ` completed:${task.completedAt}` : ''}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function parseBoard(raw: string): Board {
  const board: Board = { tasks: [], version: 1 };
  const lines = raw.split('\n');

  let currentStatus: string | null = null;
  let currentTask: Partial<BoardTask> | null = null;

  const statusMap: Record<string, string> = {
    'proposed': 'proposed',
    'approved': 'approved',
    'in progress': 'in_progress',
    'in_progress': 'in_progress',
    'done': 'done',
    'rejected': 'rejected',
  };

  for (const line of lines) {
    // last planned
    const planMatch = line.match(/^Last planned:\s*(.+)/);
    if (planMatch) {
      board.lastPlanAt = planMatch[1].trim();
      continue;
    }

    // column header
    const headerMatch = line.match(/^## (.+)/);
    if (headerMatch) {
      if (currentTask?.id) {
        board.tasks.push(currentTask as BoardTask);
        currentTask = null;
      }
      const headerText = headerMatch[1].toLowerCase();
      for (const [key, value] of Object.entries(statusMap)) {
        if (headerText.includes(key)) {
          currentStatus = value;
          break;
        }
      }
      continue;
    }

    // task line
    const taskMatch = line.match(/^- \*\*#(\d+)\*\*\s+(.+)/);
    if (taskMatch) {
      if (currentTask?.id) {
        board.tasks.push(currentTask as BoardTask);
      }

      const titlePart = taskMatch[2];
      const priorityMatch = titlePart.match(/\(high\)|\(low\)/);
      const tagsMatch = titlePart.match(/\[([^\]]+)\]/);
      let title = titlePart
        .replace(/\s*\(high\)\s*/, ' ')
        .replace(/\s*\(low\)\s*/, ' ')
        .replace(/\s*\[[^\]]+\]\s*/, ' ')
        .trim();

      currentTask = {
        id: taskMatch[1],
        title,
        status: (currentStatus || 'proposed') as BoardTask['status'],
        priority: priorityMatch ? (priorityMatch[0].replace(/[()]/g, '') as BoardTask['priority']) : 'medium',
        source: 'agent',
        tags: tagsMatch ? tagsMatch[1].split(',').map(s => s.trim()) : undefined,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      continue;
    }

    // metadata line
    if (currentTask && line.match(/^\s+source:/)) {
      const sourceMatch = line.match(/source:(\w+)/);
      const createdMatch = line.match(/created:(\S+)/);
      const updatedMatch = line.match(/updated:(\S+)/);
      const completedMatch = line.match(/completed:(\S+)/);
      if (sourceMatch) currentTask.source = sourceMatch[1] as 'agent' | 'user';
      if (createdMatch) currentTask.createdAt = createdMatch[1];
      if (updatedMatch) currentTask.updatedAt = updatedMatch[1];
      if (completedMatch) currentTask.completedAt = completedMatch[1];
      continue;
    }

    // description or result
    if (currentTask && line.match(/^\s+Result:\s/)) {
      currentTask.result = line.replace(/^\s+Result:\s*/, '');
    } else if (currentTask && line.match(/^\s+\S/) && !line.match(/^\s+source:/)) {
      currentTask.description = (currentTask.description ? currentTask.description + ' ' : '') + line.trim();
    }
  }

  if (currentTask?.id) {
    board.tasks.push(currentTask as BoardTask);
  }

  return board;
}

// ── MCP Tools ──

export const boardViewTool = tool(
  'board_view',
  'View the kanban board - shows all tasks organized by status (proposed, approved, in_progress, done). Use this to see what needs to be done.',
  {
    status: z.enum(['all', 'proposed', 'approved', 'in_progress', 'done', 'rejected']).optional()
      .describe('Filter by status. Default: all active (excludes done/rejected)'),
  },
  async (args) => {
    const board = loadBoard();
    const filter = args.status || 'all';

    let tasks = board.tasks;
    if (filter === 'all') {
      tasks = tasks.filter(t => !['done', 'rejected'].includes(t.status));
    } else {
      tasks = tasks.filter(t => t.status === filter);
    }

    if (tasks.length === 0) {
      return { content: [{ type: 'text', text: filter === 'all' ? 'Board is empty. No active tasks.' : `No tasks with status: ${filter}` }] };
    }

    const formatted = tasks.map(t => {
      const tags = t.tags?.length ? ` [${t.tags.join(', ')}]` : '';
      const desc = t.description ? `\n  ${t.description}` : '';
      const result = t.result ? `\n  Result: ${t.result}` : '';
      return `#${t.id} [${t.status}] ${t.priority === 'medium' ? '' : `(${t.priority}) `}${t.title}${tags}${desc}${result}`;
    }).join('\n\n');

    return {
      content: [{ type: 'text', text: `Board (${tasks.length} tasks):\n\n${formatted}` }],
    };
  }
);

export const boardAddTool = tool(
  'board_add',
  'Add a task to the board. Agent-proposed tasks start as "proposed" (need user approval). User-requested tasks start as "approved".',
  {
    title: z.string().describe('Short task title'),
    description: z.string().optional().describe('Detailed description of what needs to be done'),
    priority: z.enum(['high', 'medium', 'low']).optional().describe('Task priority. Default: medium'),
    source: z.enum(['agent', 'user']).optional().describe('Who created this task. Default: agent'),
    status: z.enum(['proposed', 'approved']).optional().describe('Initial status. Agent tasks default to proposed, user tasks to approved'),
    tags: z.array(z.string()).optional().describe('Tags for categorization'),
  },
  async (args) => {
    const board = loadBoard();
    const source = args.source || 'agent';
    const status = args.status || (source === 'user' ? 'approved' : 'proposed');
    const now = new Date().toISOString();

    const task: BoardTask = {
      id: nextId(board),
      title: args.title,
      description: args.description,
      status,
      priority: args.priority || 'medium',
      source,
      createdAt: now,
      updatedAt: now,
      tags: args.tags,
    };

    board.tasks.push(task);
    saveBoard(board);

    return {
      content: [{ type: 'text', text: `Task #${task.id} added: "${task.title}" [${task.status}]` }],
    };
  }
);

export const boardUpdateTool = tool(
  'board_update',
  'Update a task on the board. Use to change status, add results, or modify details.',
  {
    id: z.string().describe('Task ID (number)'),
    status: z.enum(['proposed', 'approved', 'in_progress', 'done', 'rejected']).optional()
      .describe('New status'),
    result: z.string().optional().describe('Result or outcome of the task'),
    title: z.string().optional().describe('Updated title'),
    description: z.string().optional().describe('Updated description'),
    priority: z.enum(['high', 'medium', 'low']).optional().describe('Updated priority'),
  },
  async (args) => {
    const board = loadBoard();
    const task = board.tasks.find(t => t.id === args.id);
    if (!task) {
      return { content: [{ type: 'text', text: `Task #${args.id} not found` }], isError: true };
    }

    const now = new Date().toISOString();
    if (args.status) task.status = args.status;
    if (args.result) task.result = args.result;
    if (args.title) task.title = args.title;
    if (args.description) task.description = args.description;
    if (args.priority) task.priority = args.priority;
    task.updatedAt = now;

    if (args.status === 'done') {
      task.completedAt = now;
    }

    saveBoard(board);

    return {
      content: [{ type: 'text', text: `Task #${task.id} updated: "${task.title}" [${task.status}]${args.result ? ` - ${args.result}` : ''}` }],
    };
  }
);

export const boardBatchProposeTool = tool(
  'board_propose',
  'Propose multiple tasks at once for user approval. Used during planning cycles to batch-propose work.',
  {
    tasks: z.array(z.object({
      title: z.string(),
      description: z.string().optional(),
      priority: z.enum(['high', 'medium', 'low']).optional(),
      tags: z.array(z.string()).optional(),
    })).describe('Array of tasks to propose'),
  },
  async (args) => {
    const board = loadBoard();
    const now = new Date().toISOString();
    const added: string[] = [];

    for (const t of args.tasks) {
      const task: BoardTask = {
        id: nextId(board),
        title: t.title,
        description: t.description,
        status: 'proposed',
        priority: t.priority || 'medium',
        source: 'agent',
        createdAt: now,
        updatedAt: now,
        tags: t.tags,
      };
      board.tasks.push(task);
      added.push(`#${task.id}: ${task.title}`);
    }

    board.lastPlanAt = now;
    saveBoard(board);

    return {
      content: [{ type: 'text', text: `Proposed ${added.length} tasks:\n${added.join('\n')}` }],
    };
  }
);

export const boardTools = [
  boardViewTool,
  boardAddTool,
  boardUpdateTool,
  boardBatchProposeTool,
];
