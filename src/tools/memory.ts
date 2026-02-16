import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { getDb, extractMessageText } from '../db.js';
import { AUTONOMOUS_SCHEDULE_ID } from '../autonomous.js';

const MEMORY_ORIGINS = [
  'pulse',
  'scheduled_task',
  'desktop_user',
  'telegram_user',
  'whatsapp_user',
  'user_initiated',
] as const;

type MemoryOrigin = (typeof MEMORY_ORIGINS)[number];

function classifySessionOrigin(channel?: string | null, chatId?: string | null): MemoryOrigin | 'other' {
  if (channel === 'calendar') {
    return (chatId || '').startsWith(AUTONOMOUS_SCHEDULE_ID) ? 'pulse' : 'scheduled_task';
  }
  if (channel === 'desktop') return 'desktop_user';
  if (channel === 'telegram') return 'telegram_user';
  if (channel === 'whatsapp') return 'whatsapp_user';
  return 'other';
}

function originFilterSql(origin: MemoryOrigin): { clause: string; params: unknown[] } {
  switch (origin) {
    case 'pulse':
      return {
        clause: '(s.channel = ? AND s.chat_id LIKE ?)',
        params: ['calendar', `${AUTONOMOUS_SCHEDULE_ID}%`],
      };
    case 'scheduled_task':
      return {
        clause: '(s.channel = ? AND (s.chat_id IS NULL OR s.chat_id NOT LIKE ?))',
        params: ['calendar', `${AUTONOMOUS_SCHEDULE_ID}%`],
      };
    case 'desktop_user':
      return { clause: 's.channel = ?', params: ['desktop'] };
    case 'telegram_user':
      return { clause: 's.channel = ?', params: ['telegram'] };
    case 'whatsapp_user':
      return { clause: 's.channel = ?', params: ['whatsapp'] };
    case 'user_initiated':
      return { clause: "s.channel IN ('desktop','telegram','whatsapp')", params: [] };
  }
}

// ── memory_search: FTS5 search over all past conversations ──

export const memorySearchTool = tool(
  'memory_search',
  'Search your past conversations and memory. Uses full-text search across all messages (user, assistant, tool calls, tool results). Returns ranked snippets with session context and origin labels (pulse, scheduled task, desktop user, telegram user, etc).',
  {
    query: z.string().describe('Search query. Supports FTS5 syntax: simple words, "exact phrase", word1 OR word2, word1 AND word2, word1 NOT word2'),
    limit: z.number().optional().describe('Max results to return (default 20, max 50)'),
    channel: z.string().optional().describe('Filter by channel: desktop, telegram, whatsapp, slack'),
    origin: z.enum(MEMORY_ORIGINS).optional()
      .describe('Filter by conversation origin: pulse, scheduled_task, desktop_user, telegram_user, whatsapp_user, user_initiated'),
    type: z.enum(['user', 'assistant', 'result']).optional().describe('Filter by message type'),
    after: z.string().optional().describe('Only messages after this date (ISO 8601 or YYYY-MM-DD)'),
    before: z.string().optional().describe('Only messages before this date (ISO 8601 or YYYY-MM-DD)'),
  },
  async (args) => {
    const db = getDb();
    const limit = Math.min(args.limit || 20, 50);

    try {
      // build FTS query - escape user input for safety
      const ftsQuery = args.query;

      // base query: join FTS results back to messages and sessions
      let sql = `
        SELECT
          m.id,
          m.session_id,
          m.type,
          m.timestamp,
          m.content,
          s.channel,
          s.chat_id,
          s.sender_name,
          f.rank
        FROM messages_fts f
        JOIN messages m ON m.id = f.rowid
        LEFT JOIN sessions s ON s.id = m.session_id
        WHERE messages_fts MATCH ?
      `;
      const params: unknown[] = [ftsQuery];

      if (args.channel) {
        sql += ' AND s.channel = ?';
        params.push(args.channel);
      }
      if (args.origin) {
        const { clause, params: originParams } = originFilterSql(args.origin);
        sql += ` AND ${clause}`;
        params.push(...originParams);
      }
      if (args.type) {
        sql += ' AND m.type = ?';
        params.push(args.type);
      }
      if (args.after) {
        sql += ' AND m.timestamp >= ?';
        params.push(args.after);
      }
      if (args.before) {
        sql += ' AND m.timestamp <= ?';
        params.push(args.before);
      }

      sql += ' ORDER BY f.rank LIMIT ?';
      params.push(limit);

      const rows = db.prepare(sql).all(...params) as {
        id: number;
        session_id: string;
        type: string;
        timestamp: string;
        content: string;
        channel: string | null;
        chat_id: string | null;
        sender_name: string | null;
        rank: number;
      }[];

      if (rows.length === 0) {
        return { content: [{ type: 'text', text: `No results found for: "${args.query}"` }] };
      }

      const results = rows.map((row, i) => {
        const text = extractMessageText(row.content);
        // truncate long results for readability
        const preview = text.length > 500 ? text.slice(0, 500) + '...' : text;
        const channel = row.channel ? ` [${row.channel}]` : '';
        const origin = classifySessionOrigin(row.channel, row.chat_id);
        const originTag = ` [origin:${origin}]`;
        const date = row.timestamp.slice(0, 16).replace('T', ' ');
        return `${i + 1}. [${row.type}]${channel}${originTag} ${date} (session: ${row.session_id})\n${preview}`;
      });

      return {
        content: [{
          type: 'text',
          text: `Found ${rows.length} result${rows.length === 1 ? '' : 's'} for "${args.query}":\n\n${results.join('\n\n---\n\n')}`,
        }],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // common FTS5 syntax errors
      if (msg.includes('fts5: syntax error') || msg.includes('no such column')) {
        return {
          content: [{ type: 'text', text: `Search syntax error. Try simpler keywords or quote exact phrases. Error: ${msg}` }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: `Search failed: ${msg}` }],
        isError: true,
      };
    }
  }
);

// ── memory_read: paginated conversation reader ──

export const memoryReadTool = tool(
  'memory_read',
  'Read a past conversation by session ID, with pagination. Returns the full message flow (user messages, assistant responses, tool calls, tool results) and origin classification.',
  {
    session_id: z.string().describe('Session ID to read (get this from memory_search results or session list)'),
    page: z.number().optional().describe('Page number, 1-indexed (default 1)'),
    page_size: z.number().optional().describe('Messages per page (default 20, max 50)'),
    types: z.array(z.enum(['user', 'assistant', 'system', 'result'])).optional()
      .describe('Filter message types. Default: user, assistant, result (excludes system init messages)'),
  },
  async (args) => {
    const db = getDb();
    const page = Math.max(args.page || 1, 1);
    const pageSize = Math.min(args.page_size || 20, 50);
    const offset = (page - 1) * pageSize;
    const types = args.types || ['user', 'assistant', 'result'];

    // get session info
    const session = db.prepare('SELECT id, channel, chat_id, chat_type, sender_name, created_at, updated_at FROM sessions WHERE id = ?')
      .get(args.session_id) as {
        id: string; channel: string | null; chat_id: string | null; chat_type: string | null;
        sender_name: string | null; created_at: string | null; updated_at: string | null;
      } | undefined;

    if (!session) {
      // try partial match
      const partialRows = db.prepare('SELECT id FROM sessions WHERE id LIKE ? ORDER BY updated_at DESC LIMIT 5')
        .all(`%${args.session_id}%`) as { id: string }[];
      if (partialRows.length > 0) {
        const suggestions = partialRows.map(r => r.id).join('\n  ');
        return {
          content: [{ type: 'text', text: `Session "${args.session_id}" not found. Did you mean:\n  ${suggestions}` }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: `Session "${args.session_id}" not found.` }],
        isError: true,
      };
    }

    // get total count for pagination info
    const placeholders = types.map(() => '?').join(',');
    const totalRow = db.prepare(
      `SELECT COUNT(*) as c FROM messages WHERE session_id = ? AND type IN (${placeholders})`
    ).get(args.session_id, ...types) as { c: number };
    const total = totalRow.c;
    const totalPages = Math.ceil(total / pageSize);

    if (total === 0) {
      return {
        content: [{ type: 'text', text: `Session "${args.session_id}" has no messages matching the filter.` }],
      };
    }

    // fetch page
    const rows = db.prepare(
      `SELECT id, type, content, timestamp FROM messages
       WHERE session_id = ? AND type IN (${placeholders})
       ORDER BY id
       LIMIT ? OFFSET ?`
    ).all(args.session_id, ...types, pageSize, offset) as {
      id: number; type: string; content: string; timestamp: string;
    }[];

    // format header
    const channel = session.channel ? ` | channel: ${session.channel}` : '';
    const origin = classifySessionOrigin(session.channel, session.chat_id);
    const originLabel = ` | origin: ${origin}`;
    const sender = session.sender_name ? ` | sender: ${session.sender_name}` : '';
    const created = session.created_at ? session.created_at.slice(0, 16).replace('T', ' ') : 'unknown';
    const header = `Session: ${session.id}${channel}${originLabel}${sender}\nCreated: ${created} | Messages: ${total} | Page ${page}/${totalPages}`;

    // format messages
    const formatted = rows.map(row => {
      const time = row.timestamp.slice(11, 16); // HH:MM
      const text = extractMessageText(row.content);

      if (row.type === 'user') {
        // check for tool results vs actual user messages
        const parsed = safeJsonParse(row.content);
        const blocks = parsed?.message?.content;
        if (Array.isArray(blocks)) {
          const parts: string[] = [];
          for (const block of blocks) {
            if (block?.type === 'text' && block.text) {
              parts.push(block.text);
            } else if (block?.type === 'tool_result') {
              const toolContent = typeof block.content === 'string'
                ? block.content
                : Array.isArray(block.content)
                  ? block.content.filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('\n')
                  : '';
              if (toolContent) {
                const preview = toolContent.length > 300 ? toolContent.slice(0, 300) + '...' : toolContent;
                parts.push(`[tool_result for ${block.tool_use_id?.slice(-8) || '?'}] ${preview}`);
              }
            }
          }
          if (parts.length > 0) return `[${time}] USER: ${parts.join('\n')}`;
        }
        const preview = text.length > 500 ? text.slice(0, 500) + '...' : text;
        return `[${time}] USER: ${preview}`;
      }

      if (row.type === 'assistant') {
        const parsed = safeJsonParse(row.content);
        const blocks = parsed?.message?.content;
        if (Array.isArray(blocks)) {
          const parts: string[] = [];
          for (const block of blocks) {
            if (block?.type === 'text' && block.text) {
              const preview = block.text.length > 500 ? block.text.slice(0, 500) + '...' : block.text;
              parts.push(preview);
            } else if (block?.type === 'tool_use') {
              const inputStr = block.input ? JSON.stringify(block.input) : '';
              const preview = inputStr.length > 200 ? inputStr.slice(0, 200) + '...' : inputStr;
              parts.push(`[tool_use: ${block.name}] ${preview}`);
            }
          }
          if (parts.length > 0) return `[${time}] ASSISTANT: ${parts.join('\n')}`;
        }
        const preview = text.length > 500 ? text.slice(0, 500) + '...' : text;
        return `[${time}] ASSISTANT: ${preview}`;
      }

      if (row.type === 'result') {
        const parsed = safeJsonParse(row.content);
        const cost = parsed?.total_cost_usd ? ` ($${parsed.total_cost_usd.toFixed(4)})` : '';
        const duration = parsed?.duration_ms ? ` ${(parsed.duration_ms / 1000).toFixed(1)}s` : '';
        const resultText = text.length > 300 ? text.slice(0, 300) + '...' : text;
        return `[${time}] RESULT:${duration}${cost} ${resultText}`;
      }

      return `[${time}] ${row.type.toUpperCase()}: ${text.slice(0, 300)}`;
    });

    const footer = page < totalPages ? `\n\n--- Page ${page}/${totalPages}. Use page:${page + 1} for more. ---` : `\n\n--- End of conversation (${total} messages) ---`;

    return {
      content: [{
        type: 'text',
        text: `${header}\n${'─'.repeat(60)}\n\n${formatted.join('\n\n')}\n${footer}`,
      }],
    };
  }
);

function safeJsonParse(s: string): any {
  try { return JSON.parse(s); } catch { return null; }
}

export const memoryTools = [memorySearchTool, memoryReadTool];
