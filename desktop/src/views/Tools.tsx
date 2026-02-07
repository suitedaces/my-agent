import { useState, useEffect, useMemo } from 'react';
import type { useGateway } from '../hooks/useGateway';

type Props = {
  gateway: ReturnType<typeof useGateway>;
};

type ToolCategory = 'built-in' | 'custom' | 'cron' | 'messaging';

type ToolInfo = {
  name: string;
  category: ToolCategory;
  description: string;
  parameters?: Record<string, { type: string; description: string; required: boolean }>;
};

const TOOL_DEFINITIONS: ToolInfo[] = [
  // Built-in Claude Code tools
  {
    name: 'Read',
    category: 'built-in',
    description: 'Read file contents with line numbers',
    parameters: {
      file_path: { type: 'string', description: 'Absolute path to file', required: true },
      offset: { type: 'number', description: 'Line offset to start reading', required: false },
      limit: { type: 'number', description: 'Number of lines to read', required: false },
    },
  },
  {
    name: 'Write',
    category: 'built-in',
    description: 'Write content to a file (overwrites existing)',
    parameters: {
      file_path: { type: 'string', description: 'Absolute path to file', required: true },
      content: { type: 'string', description: 'Content to write', required: true },
    },
  },
  {
    name: 'Edit',
    category: 'built-in',
    description: 'Replace text in file using exact string matching',
    parameters: {
      file_path: { type: 'string', description: 'Absolute path to file', required: true },
      old_string: { type: 'string', description: 'Text to replace', required: true },
      new_string: { type: 'string', description: 'Replacement text', required: true },
      replace_all: { type: 'boolean', description: 'Replace all occurrences', required: false },
    },
  },
  {
    name: 'Bash',
    category: 'built-in',
    description: 'Execute shell commands',
    parameters: {
      command: { type: 'string', description: 'Command to execute', required: true },
      timeout: { type: 'number', description: 'Timeout in ms (max 600000)', required: false },
      run_in_background: { type: 'boolean', description: 'Run in background', required: false },
    },
  },
  {
    name: 'Glob',
    category: 'built-in',
    description: 'Find files by pattern (e.g., **/*.ts)',
    parameters: {
      pattern: { type: 'string', description: 'Glob pattern', required: true },
      path: { type: 'string', description: 'Directory to search', required: false },
    },
  },
  {
    name: 'Grep',
    category: 'built-in',
    description: 'Search file contents with regex',
    parameters: {
      pattern: { type: 'string', description: 'Regex pattern', required: true },
      path: { type: 'string', description: 'File or directory', required: false },
      glob: { type: 'string', description: 'Filter by glob pattern', required: false },
      output_mode: { type: 'string', description: 'content|files_with_matches|count', required: false },
    },
  },
  {
    name: 'WebFetch',
    category: 'built-in',
    description: 'Fetch and process web content',
    parameters: {
      url: { type: 'string', description: 'URL to fetch', required: true },
      prompt: { type: 'string', description: 'What to extract from page', required: true },
    },
  },
  {
    name: 'WebSearch',
    category: 'built-in',
    description: 'Search the web for current information',
    parameters: {
      query: { type: 'string', description: 'Search query', required: true },
      allowed_domains: { type: 'array', description: 'Only these domains', required: false },
      blocked_domains: { type: 'array', description: 'Exclude these domains', required: false },
    },
  },
  {
    name: 'Task',
    category: 'built-in',
    description: 'Launch specialized agent for complex tasks',
    parameters: {
      subagent_type: { type: 'string', description: 'Agent type: Bash|Explore|Plan|etc', required: true },
      prompt: { type: 'string', description: 'Task description', required: true },
      description: { type: 'string', description: 'Short 3-5 word summary', required: true },
    },
  },
  {
    name: 'AskUserQuestion',
    category: 'built-in',
    description: 'Ask user questions with multiple choice answers',
    parameters: {
      questions: { type: 'array', description: 'Questions to ask (1-4)', required: true },
    },
  },
  {
    name: 'TodoWrite',
    category: 'built-in',
    description: 'Manage task list for tracking progress',
    parameters: {
      todos: { type: 'array', description: 'Todo items with status', required: true },
    },
  },

  // Messaging tool
  {
    name: 'message',
    category: 'messaging',
    description: 'Send, edit, or delete messages on channels',
    parameters: {
      action: { type: 'string', description: 'send|edit|delete', required: true },
      channel: { type: 'string', description: 'whatsapp|telegram|console', required: true },
      target: { type: 'string', description: 'Chat ID or recipient', required: false },
      message: { type: 'string', description: 'Message content', required: false },
      messageId: { type: 'string', description: 'ID for edit/delete', required: false },
    },
  },

  // Cron tools
  {
    name: 'schedule_reminder',
    category: 'cron',
    description: 'Schedule one-time reminder',
    parameters: {
      message: { type: 'string', description: 'Reminder message', required: true },
      delay: { type: 'string', description: '20m, 2h, 1d, or ISO timestamp', required: true },
      description: { type: 'string', description: 'Human-readable name', required: false },
      invoke_agent: { type: 'boolean', description: 'Have agent process message', required: false },
    },
  },
  {
    name: 'schedule_recurring',
    category: 'cron',
    description: 'Schedule recurring task',
    parameters: {
      message: { type: 'string', description: 'Task message', required: true },
      every: { type: 'string', description: 'Interval: 30m, 4h, 1d', required: true },
      description: { type: 'string', description: 'Human-readable name', required: false },
      invoke_agent: { type: 'boolean', description: 'Have agent process message', required: false },
    },
  },
  {
    name: 'schedule_cron',
    category: 'cron',
    description: 'Schedule with cron expression',
    parameters: {
      message: { type: 'string', description: 'Task message', required: true },
      cron: { type: 'string', description: '5-field cron: 0 9 * * *', required: true },
      description: { type: 'string', description: 'Human-readable name', required: false },
      timezone: { type: 'string', description: 'Timezone', required: false },
      invoke_agent: { type: 'boolean', description: 'Have agent process message', required: false },
    },
  },
  {
    name: 'list_reminders',
    category: 'cron',
    description: 'List all scheduled tasks',
  },
  {
    name: 'cancel_reminder',
    category: 'cron',
    description: 'Cancel scheduled task',
    parameters: {
      job_id: { type: 'string', description: 'Job ID to cancel', required: true },
    },
  },
];

const CATEGORY_LABELS: Record<ToolCategory, { label: string; color: string; icon: string }> = {
  'built-in': { label: 'Built-in', color: 'var(--accent-blue)', icon: '⚡' },
  'custom': { label: 'Custom', color: 'var(--accent-purple)', icon: '🔧' },
  'cron': { label: 'Scheduling', color: 'var(--accent-green)', icon: '⏰' },
  'messaging': { label: 'Messaging', color: 'var(--accent-yellow)', icon: '💬' },
};

export function ToolsView({ gateway }: Props) {
  const [selectedCategory, setSelectedCategory] = useState<ToolCategory | 'all'>('all');
  const [selectedTool, setSelectedTool] = useState<ToolInfo | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // track tool usage from chat
  const toolUsage = useMemo(() => {
    const usage = new Map<string, number>();
    for (const item of gateway.chatItems) {
      if (item.type === 'tool_use') {
        usage.set(item.name, (usage.get(item.name) || 0) + 1);
      }
    }
    return usage;
  }, [gateway.chatItems]);

  const filteredTools = useMemo(() => {
    let tools = TOOL_DEFINITIONS;

    if (selectedCategory !== 'all') {
      tools = tools.filter(t => t.category === selectedCategory);
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      tools = tools.filter(
        t => t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q)
      );
    }

    return tools;
  }, [selectedCategory, searchQuery]);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: TOOL_DEFINITIONS.length };
    for (const tool of TOOL_DEFINITIONS) {
      counts[tool.category] = (counts[tool.category] || 0) + 1;
    }
    return counts;
  }, []);

  return (
    <div className="chat-view">
      <div className="view-header">
        Tools
        <span className="badge" style={{ marginLeft: 8 }}>
          {filteredTools.length} tools
        </span>
      </div>

      <div className="view-body">
        {/* search and filter */}
        <div style={{ marginBottom: 16 }}>
          <input
            type="text"
            placeholder="Search tools..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 12px',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              color: 'var(--text-primary)',
              fontSize: 12,
            }}
          />
        </div>

        {/* category filters */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          <button
            className={`btn ${selectedCategory === 'all' ? 'btn-active' : ''}`}
            onClick={() => setSelectedCategory('all')}
            style={{ fontSize: 11 }}
          >
            All ({categoryCounts.all})
          </button>
          {Object.entries(CATEGORY_LABELS).map(([cat, info]) => (
            <button
              key={cat}
              className={`btn ${selectedCategory === cat ? 'btn-active' : ''}`}
              onClick={() => setSelectedCategory(cat as ToolCategory)}
              style={{ fontSize: 11 }}
            >
              {info.icon} {info.label} ({categoryCounts[cat] || 0})
            </button>
          ))}
        </div>

        {/* tools list */}
        <div style={{ display: 'grid', gap: 12 }}>
          {filteredTools.map(tool => {
            const categoryInfo = CATEGORY_LABELS[tool.category];
            const usageCount = toolUsage.get(tool.name) || 0;
            const isSelected = selectedTool?.name === tool.name;

            return (
              <div
                key={tool.name}
                className="card"
                style={{
                  cursor: 'pointer',
                  borderColor: isSelected ? 'var(--accent-blue)' : 'var(--border)',
                }}
                onClick={() => setSelectedTool(isSelected ? null : tool)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 14 }}>{categoryInfo.icon}</span>
                  <span className="card-title" style={{ flex: 1 }}>{tool.name}</span>
                  {usageCount > 0 && (
                    <span
                      className="badge"
                      style={{
                        background: 'var(--accent-blue-bg)',
                        color: 'var(--accent-blue)',
                        fontSize: 10,
                      }}
                    >
                      {usageCount}x
                    </span>
                  )}
                  <span className="card-meta" style={{ color: categoryInfo.color }}>
                    {categoryInfo.label}
                  </span>
                </div>

                <div className="card-body" style={{ fontSize: 11 }}>
                  {tool.description}
                </div>

                {isSelected && tool.parameters && (
                  <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                    <div style={{ fontWeight: 600, fontSize: 11, marginBottom: 8, color: 'var(--text-secondary)' }}>
                      Parameters:
                    </div>
                    <div style={{ display: 'grid', gap: 8 }}>
                      {Object.entries(tool.parameters).map(([name, param]) => (
                        <div
                          key={name}
                          style={{
                            fontSize: 10,
                            padding: '6px 8px',
                            background: 'var(--bg-secondary)',
                            borderRadius: 4,
                            border: '1px solid var(--border)',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-blue)' }}>
                              {name}
                            </span>
                            <span style={{ color: 'var(--text-muted)', fontSize: 9 }}>
                              {param.type}
                            </span>
                            {param.required && (
                              <span
                                style={{
                                  fontSize: 8,
                                  padding: '1px 4px',
                                  background: 'var(--accent-red-bg)',
                                  color: 'var(--accent-red)',
                                  borderRadius: 2,
                                }}
                              >
                                required
                              </span>
                            )}
                          </div>
                          <div style={{ color: 'var(--text-muted)' }}>
                            {param.description}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {filteredTools.length === 0 && (
          <div className="empty-state">
            <div>No tools found</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
              Try a different search or category
            </div>
          </div>
        )}

        {/* usage stats */}
        {toolUsage.size > 0 && selectedCategory === 'all' && !searchQuery && (
          <div className="card" style={{ marginTop: 16 }}>
            <div className="card-title">Most Used (this session)</div>
            <div className="card-body">
              {Array.from(toolUsage.entries())
                .sort((a, b) => b[1] - a[1])
                .slice(0, 10)
                .map(([name, count]) => (
                  <div
                    key={name}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '4px 0',
                      fontSize: 11,
                    }}
                  >
                    <span style={{ fontFamily: 'var(--font-mono)' }}>{name}</span>
                    <span className="badge">{count}x</span>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
