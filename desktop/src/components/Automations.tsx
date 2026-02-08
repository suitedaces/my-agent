import { useState, useEffect, useCallback } from 'react';
import type { useGateway } from '../hooks/useGateway';
import type { CronJob } from '../../../src/cron/scheduler';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import { Plus, X, Play, Pause, Trash2, ChevronDown, ChevronRight, Clock, Zap } from 'lucide-react';

type AutomationsProps = {
  gateway: ReturnType<typeof useGateway>;
};

export function Automations({ gateway }: AutomationsProps) {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [expandedJob, setExpandedJob] = useState<string | null>(null);
  const [newJob, setNewJob] = useState({
    name: '',
    message: '',
    type: 'one-time' as 'one-time' | 'recurring' | 'cron',
    at: '',
    every: '',
    cron: '',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });

  const loadJobs = useCallback(async () => {
    if (gateway.connectionState !== 'connected') return;
    try {
      const result = await gateway.rpc('cron.list');
      if (Array.isArray(result)) setJobs(result);
      setLoading(false);
    } catch (err) {
      console.error('failed to load cron jobs:', err);
      setLoading(false);
    }
  }, [gateway.connectionState, gateway.rpc]);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  const resetForm = () => {
    setNewJob({
      name: '',
      message: '',
      type: 'one-time',
      at: '',
      every: '',
      cron: '',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    setShowAddForm(false);
  };

  const addJob = async () => {
    const jobData: Record<string, unknown> = {
      name: newJob.name || 'Unnamed Task',
      message: newJob.message,
      timezone: newJob.timezone,
      enabled: true,
    };

    if (newJob.type === 'one-time') {
      jobData.at = newJob.at;
      jobData.deleteAfterRun = true;
    } else if (newJob.type === 'recurring') {
      jobData.every = newJob.every;
    } else if (newJob.type === 'cron') {
      jobData.cron = newJob.cron;
    }

    try {
      await gateway.rpc('cron.add', jobData);
      resetForm();
      setTimeout(loadJobs, 100);
    } catch (err) {
      console.error('failed to add job:', err);
    }
  };

  const toggleJob = async (id: string) => {
    try {
      await gateway.rpc('cron.toggle', { id });
      setTimeout(loadJobs, 100);
    } catch (err) {
      console.error('failed to toggle job:', err);
    }
  };

  const runJobNow = async (id: string) => {
    try {
      await gateway.rpc('cron.run', { id });
      setTimeout(loadJobs, 500);
    } catch (err) {
      console.error('failed to run job:', err);
    }
  };

  const deleteJob = async (id: string) => {
    try {
      await gateway.rpc('cron.remove', { id });
      setTimeout(loadJobs, 100);
    } catch (err) {
      console.error('failed to delete job:', err);
    }
  };

  const formatSchedule = (job: CronJob) => {
    if (job.cron) return `cron: ${job.cron}`;
    if (job.every) return `every ${job.every}`;
    if (job.at) return `at ${job.at}`;
    return 'unknown';
  };

  const formatTime = (iso?: string) => {
    if (!iso) return null;
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  };

  const canSubmit = newJob.message && (
    (newJob.type === 'one-time' && newJob.at) ||
    (newJob.type === 'recurring' && newJob.every) ||
    (newJob.type === 'cron' && newJob.cron)
  );

  if (gateway.connectionState !== 'connected') {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
        <Zap className="w-6 h-6 opacity-40" />
        <span className="text-sm">connecting...</span>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-4 space-y-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border shrink-0">
        <span className="font-semibold text-sm">Automations</span>
        <Badge variant="outline" className="text-[10px]">{jobs.length}</Badge>
        <Button
          variant={showAddForm ? 'outline' : 'default'}
          size="sm"
          className="ml-auto h-6 text-[11px] px-2"
          onClick={() => setShowAddForm(!showAddForm)}
        >
          {showAddForm ? <><X className="w-3 h-3 mr-1" />cancel</> : <><Plus className="w-3 h-3 mr-1" />new</>}
        </Button>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-4 space-y-4">
          {showAddForm && (
            <Card className="border-primary/50">
              <CardContent className="p-4 space-y-3">
                <div className="space-y-1">
                  <Label className="text-[11px]">name</Label>
                  <Input
                    value={newJob.name}
                    onChange={e => setNewJob({ ...newJob, name: e.target.value })}
                    placeholder="daily standup reminder"
                    className="h-8 text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-[11px]">message / task</Label>
                  <Textarea
                    value={newJob.message}
                    onChange={e => setNewJob({ ...newJob, message: e.target.value })}
                    placeholder="check project status and send update"
                    rows={3}
                    className="text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-[11px]">type</Label>
                  <div className="flex gap-1.5">
                    {(['one-time', 'recurring', 'cron'] as const).map(type => (
                      <Button
                        key={type}
                        variant={newJob.type === type ? 'default' : 'outline'}
                        size="sm"
                        className="h-6 text-[11px] px-2"
                        onClick={() => setNewJob({ ...newJob, type })}
                      >
                        {type}
                      </Button>
                    ))}
                  </div>
                </div>

                {newJob.type === 'one-time' && (
                  <div className="space-y-1">
                    <Label className="text-[11px]">run at</Label>
                    <Input
                      value={newJob.at}
                      onChange={e => setNewJob({ ...newJob, at: e.target.value })}
                      placeholder="20m, 2h, 1d, or ISO timestamp"
                      className="h-8 text-xs"
                    />
                    <span className="text-[10px] text-muted-foreground">relative (20m, 2h) or absolute (2025-01-15T09:00:00)</span>
                  </div>
                )}

                {newJob.type === 'recurring' && (
                  <div className="space-y-1">
                    <Label className="text-[11px]">repeat every</Label>
                    <Input
                      value={newJob.every}
                      onChange={e => setNewJob({ ...newJob, every: e.target.value })}
                      placeholder="30m, 4h, 1d"
                      className="h-8 text-xs"
                    />
                    <span className="text-[10px] text-muted-foreground">30m = every 30 minutes, 4h = every 4 hours</span>
                  </div>
                )}

                {newJob.type === 'cron' && (
                  <div className="space-y-1">
                    <Label className="text-[11px]">cron expression</Label>
                    <Input
                      value={newJob.cron}
                      onChange={e => setNewJob({ ...newJob, cron: e.target.value })}
                      placeholder="0 9 * * *"
                      className="h-8 text-xs font-mono"
                    />
                    <span className="text-[10px] text-muted-foreground">minute hour day month weekday — "0 9 * * *" = 9am daily</span>
                  </div>
                )}

                <Button
                  size="sm"
                  className="w-full h-7 text-xs"
                  onClick={addJob}
                  disabled={!canSubmit}
                >
                  create automation
                </Button>
              </CardContent>
            </Card>
          )}

          {jobs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
              <Clock className="w-6 h-6 opacity-40" />
              <span className="text-sm">no automations yet</span>
            </div>
          ) : (
            <div className="space-y-2">
              {jobs.map(job => {
                const isExpanded = expandedJob === job.id;
                return (
                  <Collapsible key={job.id} open={isExpanded} onOpenChange={open => setExpandedJob(open ? job.id : null)}>
                    <Card className={cn('transition-colors', isExpanded && 'border-primary/50')}>
                      <CollapsibleTrigger className="w-full">
                        <CardContent className="p-3">
                          <div className="flex items-center gap-2">
                            <Badge
                              variant={job.enabled === false ? 'outline' : 'default'}
                              className={cn('text-[9px] h-4', job.enabled !== false && 'bg-success/15 text-success border-success/30')}
                            >
                              {job.enabled === false ? 'off' : 'on'}
                            </Badge>
                            <span className="text-xs font-semibold flex-1 text-left">{job.name}</span>
                            <span className="text-[10px] text-muted-foreground">{formatSchedule(job)}</span>
                            {isExpanded ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
                          </div>
                        </CardContent>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="px-3 pb-3 pt-0 border-t border-border mt-1">
                          <div className="text-xs text-muted-foreground mt-2 mb-2 bg-secondary rounded p-2">
                            {job.message}
                          </div>
                          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground mb-2">
                            {job.nextRunAt && <span>next: {formatTime(job.nextRunAt)}</span>}
                            {job.lastRunAt && <span>last: {formatTime(job.lastRunAt)}</span>}
                            <span>created: {formatTime(job.createdAt)}</span>
                            {job.deleteAfterRun && <Badge variant="outline" className="text-[8px] h-3 px-1">one-shot</Badge>}
                          </div>
                          <div className="flex gap-1.5">
                            <Button variant="outline" size="sm" className="h-6 text-[11px] px-2" onClick={() => toggleJob(job.id)}>
                              {job.enabled === false ? <><Play className="w-3 h-3 mr-1" />enable</> : <><Pause className="w-3 h-3 mr-1" />disable</>}
                            </Button>
                            <Button variant="outline" size="sm" className="h-6 text-[11px] px-2" onClick={() => runJobNow(job.id)}>
                              <Play className="w-3 h-3 mr-1" />run now
                            </Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="destructive" size="sm" className="h-6 text-[11px] px-2">
                                  <Trash2 className="w-3 h-3 mr-1" />delete
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle className="text-sm">delete "{job.name}"?</AlertDialogTitle>
                                  <AlertDialogDescription className="text-xs">this cannot be undone.</AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel className="h-7 text-xs">cancel</AlertDialogCancel>
                                  <AlertDialogAction className="h-7 text-xs" onClick={() => deleteJob(job.id)}>delete</AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </div>
                      </CollapsibleContent>
                    </Card>
                  </Collapsible>
                );
              })}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
