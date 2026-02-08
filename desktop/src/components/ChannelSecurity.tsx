import { useState, useEffect, useCallback } from 'react';
import type { useGateway } from '../hooks/useGateway';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown, ChevronRight, X, Plus, RotateCw } from 'lucide-react';

const TOOL_NAMES = [
  'Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash',
  'WebFetch', 'WebSearch', 'Task', 'AskUserQuestion', 'TodoWrite',
  'message', 'browser', 'screenshot',
  'schedule_reminder', 'schedule_recurring', 'schedule_cron',
  'list_reminders', 'cancel_reminder',
];

type Props = {
  channel: 'whatsapp' | 'telegram';
  gateway: ReturnType<typeof useGateway>;
};

export function ChannelSecurity({ channel, gateway }: Props) {
  const [senders, setSenders] = useState<string[]>([]);
  const [dmPolicy, setDmPolicy] = useState<string>('open');
  const [groupPolicy, setGroupPolicy] = useState<string>('open');
  const [newSender, setNewSender] = useState('');
  const [expanded, setExpanded] = useState(false);

  // tool policies
  const [toolDeny, setToolDeny] = useState<string[]>([]);

  // path restrictions
  const [allowedPaths, setAllowedPaths] = useState<string[]>([]);
  const [deniedPaths, setDeniedPaths] = useState<string[]>([]);
  const [newAllowedPath, setNewAllowedPath] = useState('');
  const [newDeniedPath, setNewDeniedPath] = useState('');

  const load = useCallback(async () => {
    try {
      const [sendersResult, configResult, toolResult, pathResult] = await Promise.all([
        gateway.getSecuritySenders(),
        gateway.rpc('config.get') as Promise<any>,
        gateway.getToolPolicies(),
        gateway.getPathPolicies(),
      ]);
      setSenders(sendersResult[channel] || []);
      const ch = configResult?.channels?.[channel];
      if (ch?.dmPolicy) setDmPolicy(ch.dmPolicy);
      if (ch?.groupPolicy) setGroupPolicy(ch.groupPolicy);
      setToolDeny((toolResult as any)[channel]?.deny || []);
      setAllowedPaths((pathResult as any)[channel]?.allowed || []);
      setDeniedPaths((pathResult as any)[channel]?.denied || []);
    } catch (err) {
      console.error('failed to load security config:', err);
    }
  }, [channel, gateway]);

  useEffect(() => { load(); }, [load]);

  const handleAddSender = async () => {
    const id = newSender.trim();
    if (!id) return;
    await gateway.addSender(channel, id);
    setNewSender('');
    await load();
  };

  const handleRemoveSender = async (id: string) => {
    await gateway.removeSender(channel, id);
    await load();
  };

  const handleDmPolicy = async (value: string) => {
    setDmPolicy(value);
    await gateway.setChannelPolicy(`channels.${channel}.dmPolicy`, value);
  };

  const handleGroupPolicy = async (value: string) => {
    setGroupPolicy(value);
    await gateway.setChannelPolicy(`channels.${channel}.groupPolicy`, value);
  };

  const handleRestart = async () => {
    await gateway.restartChannel(channel);
  };

  // tool policy handlers
  const addToolDeny = async (tool: string) => {
    if (!tool.trim() || toolDeny.includes(tool)) return;
    const updated = [...toolDeny, tool];
    setToolDeny(updated);
    await gateway.setToolPolicy(channel, undefined, updated);
  };

  const removeToolDeny = async (tool: string) => {
    const updated = toolDeny.filter(t => t !== tool);
    setToolDeny(updated);
    await gateway.setToolPolicy(channel, undefined, updated);
  };

  // path handlers
  const addAllowedPath = async () => {
    if (!newAllowedPath.trim()) return;
    const updated = [...allowedPaths, newAllowedPath.trim()];
    setAllowedPaths(updated);
    setNewAllowedPath('');
    await gateway.setPathPolicy(channel, updated, undefined);
  };

  const removeAllowedPath = async (p: string) => {
    const updated = allowedPaths.filter(x => x !== p);
    setAllowedPaths(updated);
    await gateway.setPathPolicy(channel, updated, undefined);
  };

  const addDeniedPath = async () => {
    if (!newDeniedPath.trim()) return;
    const updated = [...deniedPaths, newDeniedPath.trim()];
    setDeniedPaths(updated);
    setNewDeniedPath('');
    await gateway.setPathPolicy(channel, undefined, updated);
  };

  const removeDeniedPath = async (p: string) => {
    const updated = deniedPaths.filter(x => x !== p);
    setDeniedPaths(updated);
    await gateway.setPathPolicy(channel, undefined, updated);
  };

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded}>
      <Card className="mb-3">
        <CollapsibleTrigger className="w-full">
          <CardContent className="p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold">security</span>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground">
                  {senders.length > 0 ? `${senders.length} allowed` : 'open to all'}
                  {toolDeny.length > 0 ? ` · ${toolDeny.length} tools denied` : ''}
                </span>
                {expanded ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
              </div>
            </div>
          </CardContent>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="px-3 pb-3 pt-0 border-t border-border mt-1 space-y-4">

            {/* dm/group policy */}
            <div className="space-y-3 mt-2">
              <div className="flex items-center gap-3">
                <span className="text-[11px] text-muted-foreground w-20">dm policy</span>
                <Select value={dmPolicy} onValueChange={handleDmPolicy}>
                  <SelectTrigger className="h-7 text-[11px] w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open" className="text-[11px]">open</SelectItem>
                    <SelectItem value="allowlist" className="text-[11px]">allowlist</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-3">
                <span className="text-[11px] text-muted-foreground w-20">group policy</span>
                <Select value={groupPolicy} onValueChange={handleGroupPolicy}>
                  <SelectTrigger className="h-7 text-[11px] w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open" className="text-[11px]">open</SelectItem>
                    <SelectItem value="allowlist" className="text-[11px]">allowlist</SelectItem>
                    <SelectItem value="disabled" className="text-[11px]">disabled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* allowed senders */}
            <div>
              <span className="text-[11px] text-muted-foreground">allowed senders</span>
              {senders.length === 0 && (
                <div className="text-[10px] text-muted-foreground mt-1">
                  no sender restrictions — anyone can message
                </div>
              )}
              <div className="space-y-1 mt-1">
                {senders.map(id => (
                  <div key={id} className="flex items-center gap-2 text-[11px] bg-secondary rounded px-2 py-1">
                    <code className="flex-1 text-foreground">{id}</code>
                    <button
                      className="text-muted-foreground hover:text-destructive transition-colors"
                      onClick={() => handleRemoveSender(id)}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex gap-1.5 mt-2">
                <Input
                  placeholder="sender id"
                  value={newSender}
                  onChange={e => setNewSender(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAddSender()}
                  className="flex-1 h-7 text-[11px]"
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-[11px] px-2"
                  onClick={handleAddSender}
                  disabled={!newSender.trim()}
                >
                  <Plus className="w-3 h-3 mr-1" />add
                </Button>
              </div>
            </div>

            {/* tool restrictions */}
            <div>
              <span className="text-[11px] text-muted-foreground">denied tools</span>
              {toolDeny.length === 0 && (
                <div className="text-[10px] text-muted-foreground mt-1">no channel-specific tool restrictions</div>
              )}
              <div className="flex flex-wrap gap-1 mt-1">
                {toolDeny.map(tool => (
                  <Badge key={tool} variant="destructive" className="text-[10px] h-5 gap-1 cursor-pointer" onClick={() => removeToolDeny(tool)}>
                    {tool}
                    <X className="w-2.5 h-2.5" />
                  </Badge>
                ))}
              </div>
              <div className="mt-2">
                <Select value="" onValueChange={v => addToolDeny(v)}>
                  <SelectTrigger className="h-7 text-[11px]">
                    <SelectValue placeholder="deny a tool for this channel..." />
                  </SelectTrigger>
                  <SelectContent>
                    {TOOL_NAMES.filter(t => !toolDeny.includes(t)).map(t => (
                      <SelectItem key={t} value={t} className="text-[11px]">{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* path restrictions */}
            <div>
              <span className="text-[11px] text-muted-foreground">allowed paths (overrides global if set)</span>
              {allowedPaths.length === 0 && (
                <div className="text-[10px] text-muted-foreground mt-1">using global path settings</div>
              )}
              <div className="space-y-1 mt-1">
                {allowedPaths.map(p => (
                  <div key={p} className="flex items-center gap-2 text-[11px] bg-secondary rounded px-2 py-1">
                    <code className="flex-1 text-foreground">{p}</code>
                    <button className="text-muted-foreground hover:text-destructive transition-colors" onClick={() => removeAllowedPath(p)}>
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex gap-1.5 mt-2">
                <Input
                  placeholder="/path/to/allow"
                  value={newAllowedPath}
                  onChange={e => setNewAllowedPath(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addAllowedPath()}
                  className="flex-1 h-7 text-[11px]"
                />
                <Button variant="outline" size="sm" className="h-7 text-[11px] px-2" onClick={addAllowedPath} disabled={!newAllowedPath.trim()}>
                  <Plus className="w-3 h-3 mr-1" />add
                </Button>
              </div>
            </div>

            <div>
              <span className="text-[11px] text-muted-foreground">additional denied paths</span>
              {deniedPaths.length === 0 && (
                <div className="text-[10px] text-muted-foreground mt-1">no extra denied paths for this channel</div>
              )}
              <div className="space-y-1 mt-1">
                {deniedPaths.map(p => (
                  <div key={p} className="flex items-center gap-2 text-[11px] bg-secondary rounded px-2 py-1">
                    <code className="flex-1 text-foreground">{p}</code>
                    <button className="text-muted-foreground hover:text-destructive transition-colors" onClick={() => removeDeniedPath(p)}>
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex gap-1.5 mt-2">
                <Input
                  placeholder="/path/to/deny"
                  value={newDeniedPath}
                  onChange={e => setNewDeniedPath(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addDeniedPath()}
                  className="flex-1 h-7 text-[11px]"
                />
                <Button variant="outline" size="sm" className="h-7 text-[11px] px-2" onClick={addDeniedPath} disabled={!newDeniedPath.trim()}>
                  <Plus className="w-3 h-3 mr-1" />add
                </Button>
              </div>
            </div>

            {/* restart */}
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="h-7 text-[11px] px-2" onClick={handleRestart}>
                <RotateCw className="w-3 h-3 mr-1" />restart channel
              </Button>
              <span className="text-[10px] text-muted-foreground">
                policy changes apply after restart
              </span>
            </div>
          </div>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
