import { useState, useMemo } from 'react';
import type { useGateway } from '../hooks/useGateway';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { BentoGrid, BentoGridItem } from '@/components/aceternity/bento-grid';
import { cn } from '@/lib/utils';
import { Search, Zap, Wrench, Clock, MessageSquare, ChevronDown, ChevronRight } from 'lucide-react';

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
  { name: 'Read', category: 'built-in', description: 'Read file contents with line numbers', parameters: { file_path: { type: 'string', description: 'Absolute path to file', required: true }, offset: { type: 'number', description: 'Line offset', required: false }, limit: { type: 'number', description: 'Number of lines', required: false } } },
  { name: 'Write', category: 'built-in', description: 'Write content to a file', parameters: { file_path: { type: 'string', description: 'Absolute path to file', required: true }, content: { type: 'string', description: 'Content to write', required: true } } },
  { name: 'Edit', category: 'built-in', description: 'Replace text in file', parameters: { file_path: { type: 'string', description: 'Absolute path', required: true }, old_string: { type: 'string', description: 'Text to replace', required: true }, new_string: { type: 'string', description: 'Replacement', required: true } } },
  { name: 'Bash', category: 'built-in', description: 'Execute shell commands', parameters: { command: { type: 'string', description: 'Command to execute', required: true }, timeout: { type: 'number', description: 'Timeout in ms', required: false } } },
  { name: 'Glob', category: 'built-in', description: 'Find files by pattern', parameters: { pattern: { type: 'string', description: 'Glob pattern', required: true }, path: { type: 'string', description: 'Directory', required: false } } },
  { name: 'Grep', category: 'built-in', description: 'Search file contents with regex', parameters: { pattern: { type: 'string', description: 'Regex pattern', required: true }, path: { type: 'string', description: 'File or directory', required: false } } },
  { name: 'WebFetch', category: 'built-in', description: 'Fetch and process web content', parameters: { url: { type: 'string', description: 'URL to fetch', required: true }, prompt: { type: 'string', description: 'What to extract', required: true } } },
  { name: 'WebSearch', category: 'built-in', description: 'Search the web', parameters: { query: { type: 'string', description: 'Search query', required: true } } },
  { name: 'Task', category: 'built-in', description: 'Launch specialized agent', parameters: { subagent_type: { type: 'string', description: 'Agent type', required: true }, prompt: { type: 'string', description: 'Task description', required: true } } },
  { name: 'AskUserQuestion', category: 'built-in', description: 'Ask user questions', parameters: { questions: { type: 'array', description: 'Questions (1-4)', required: true } } },
  { name: 'TodoWrite', category: 'built-in', description: 'Manage task list', parameters: { todos: { type: 'array', description: 'Todo items', required: true } } },
  { name: 'message', category: 'messaging', description: 'Send, edit, or delete messages', parameters: { action: { type: 'string', description: 'send|edit|delete', required: true }, channel: { type: 'string', description: 'whatsapp|telegram', required: true } } },
  { name: 'schedule_reminder', category: 'cron', description: 'Schedule one-time reminder', parameters: { message: { type: 'string', description: 'Reminder message', required: true }, delay: { type: 'string', description: '20m, 2h, 1d', required: true } } },
  { name: 'schedule_recurring', category: 'cron', description: 'Schedule recurring task', parameters: { message: { type: 'string', description: 'Task message', required: true }, every: { type: 'string', description: 'Interval', required: true } } },
  { name: 'schedule_cron', category: 'cron', description: 'Schedule with cron expression', parameters: { message: { type: 'string', description: 'Task message', required: true }, cron: { type: 'string', description: '5-field cron', required: true } } },
  { name: 'list_reminders', category: 'cron', description: 'List all scheduled tasks' },
  { name: 'cancel_reminder', category: 'cron', description: 'Cancel scheduled task', parameters: { job_id: { type: 'string', description: 'Job ID', required: true } } },
];

const CATEGORY_INFO: Record<ToolCategory, { label: string; icon: React.ReactNode; color: string }> = {
  'built-in': { label: 'Built-in', icon: <Zap className="w-3 h-3" />, color: 'text-primary' },
  'custom': { label: 'Custom', icon: <Wrench className="w-3 h-3" />, color: 'text-purple-400' },
  'cron': { label: 'Scheduling', icon: <Clock className="w-3 h-3" />, color: 'text-success' },
  'messaging': { label: 'Messaging', icon: <MessageSquare className="w-3 h-3" />, color: 'text-warning' },
};

export function ToolsView({ gateway }: Props) {
  const [selectedCategory, setSelectedCategory] = useState<ToolCategory | 'all'>('all');
  const [selectedTool, setSelectedTool] = useState<ToolInfo | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

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
    if (selectedCategory !== 'all') tools = tools.filter(t => t.category === selectedCategory);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      tools = tools.filter(t => t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q));
    }
    return tools;
  }, [selectedCategory, searchQuery]);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: TOOL_DEFINITIONS.length };
    for (const tool of TOOL_DEFINITIONS) counts[tool.category] = (counts[tool.category] || 0) + 1;
    return counts;
  }, []);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border shrink-0">
        <span className="font-semibold text-sm">Tools</span>
        <Badge variant="outline" className="text-[10px]">{filteredTools.length} tools</Badge>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-4 space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              placeholder="Search tools..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="pl-9 h-8 text-xs"
            />
          </div>

          <div className="flex gap-1.5 flex-wrap">
            <Button
              variant={selectedCategory === 'all' ? 'default' : 'outline'}
              size="sm"
              className="h-6 text-[11px] px-2"
              onClick={() => setSelectedCategory('all')}
            >
              All ({categoryCounts.all})
            </Button>
            {Object.entries(CATEGORY_INFO).map(([cat, info]) => (
              <Button
                key={cat}
                variant={selectedCategory === cat ? 'default' : 'outline'}
                size="sm"
                className="h-6 text-[11px] px-2"
                onClick={() => setSelectedCategory(cat as ToolCategory)}
              >
                {info.icon}
                <span className="ml-1">{info.label} ({categoryCounts[cat] || 0})</span>
              </Button>
            ))}
          </div>

          <div className="space-y-2">
            {filteredTools.map(tool => {
              const catInfo = CATEGORY_INFO[tool.category];
              const usageCount = toolUsage.get(tool.name) || 0;
              const isSelected = selectedTool?.name === tool.name;

              return (
                <Collapsible key={tool.name} open={isSelected} onOpenChange={open => setSelectedTool(open ? tool : null)}>
                  <Card className={cn('transition-colors', isSelected && 'border-primary/50')}>
                    <CollapsibleTrigger className="w-full">
                      <CardContent className="p-3">
                        <div className="flex items-center gap-2">
                          <span className={catInfo.color}>{catInfo.icon}</span>
                          <span className="text-xs font-semibold flex-1 text-left">{tool.name}</span>
                          {usageCount > 0 && <Badge variant="outline" className="text-[9px] h-4">{usageCount}x</Badge>}
                          <span className={cn('text-[10px]', catInfo.color)}>{catInfo.label}</span>
                          {isSelected ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-1 text-left">{tool.description}</div>
                      </CardContent>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      {tool.parameters && (
                        <div className="px-3 pb-3 pt-0 border-t border-border mt-1">
                          <div className="text-[11px] font-semibold text-muted-foreground mt-2 mb-2">Parameters</div>
                          <div className="space-y-1.5">
                            {Object.entries(tool.parameters).map(([name, param]) => (
                              <div key={name} className="text-[10px] px-2 py-1.5 bg-secondary rounded border border-border">
                                <div className="flex items-center gap-1.5 mb-0.5">
                                  <code className="text-primary">{name}</code>
                                  <span className="text-muted-foreground text-[9px]">{param.type}</span>
                                  {param.required && <Badge variant="destructive" className="text-[8px] h-3 px-1">required</Badge>}
                                </div>
                                <div className="text-muted-foreground">{param.description}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </CollapsibleContent>
                  </Card>
                </Collapsible>
              );
            })}
          </div>

          {filteredTools.length === 0 && (
            <div className="text-center py-8 text-muted-foreground text-sm">
              No tools found
            </div>
          )}

          {toolUsage.size > 0 && selectedCategory === 'all' && !searchQuery && (
            <Card>
              <CardContent className="p-3">
                <div className="text-xs font-semibold mb-2">Most Used (this session)</div>
                {Array.from(toolUsage.entries())
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 10)
                  .map(([name, count]) => (
                    <div key={name} className="flex items-center justify-between py-1 text-[11px]">
                      <code>{name}</code>
                      <Badge variant="outline" className="text-[9px] h-4">{count}x</Badge>
                    </div>
                  ))}
              </CardContent>
            </Card>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
