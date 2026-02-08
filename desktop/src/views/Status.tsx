import { useState, useEffect } from 'react';
import type { useGateway } from '../hooks/useGateway';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { BentoGrid, BentoGridItem } from '@/components/aceternity/bento-grid';
import { Shield, Wifi, Radio, Database, FileJson } from 'lucide-react';

type Props = {
  gateway: ReturnType<typeof useGateway>;
};

export function StatusView({ gateway }: Props) {
  const [statusData, setStatusData] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    if (gateway.connectionState !== 'connected') return;
    gateway.rpc('status')
      .then(res => setStatusData(res as Record<string, unknown>))
      .catch(() => {});
  }, [gateway.connectionState, gateway.rpc]);

  const hasToken = !!(window as any).electronAPI?.getGatewayToken?.() || !!(window as any).electronAPI?.gatewayToken || !!localStorage.getItem('my-agent:gateway-token');

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border shrink-0">
        <span className="font-semibold text-sm">Status</span>
        <Badge variant={gateway.connectionState === 'connected' ? 'default' : 'destructive'}>
          {gateway.connectionState}
        </Badge>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-4">
          <BentoGrid className="grid-cols-2 gap-3">
            <BentoGridItem className="col-span-1">
              <Card>
                <CardContent className="p-3">
                  <div className="flex items-center gap-2 mb-3">
                    <Shield className="w-4 h-4 text-primary" />
                    <span className="text-xs font-semibold">Security</span>
                  </div>
                  <div className="space-y-2 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">gateway auth:</span>
                      <Badge variant={hasToken ? 'default' : 'destructive'} className="text-[9px] h-4">
                        {hasToken ? 'token active' : 'no token'}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">pending approvals:</span>
                      <span className={gateway.pendingApprovals.length > 0 ? 'text-warning' : 'text-muted-foreground'}>
                        {gateway.pendingApprovals.length}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </BentoGridItem>

            <BentoGridItem className="col-span-1">
              <Card>
                <CardContent className="p-3">
                  <div className="flex items-center gap-2 mb-3">
                    <Wifi className="w-4 h-4 text-primary" />
                    <span className="text-xs font-semibold">Gateway</span>
                  </div>
                  <div className="space-y-1 text-xs text-muted-foreground">
                    <div>connection: <span className="text-foreground">{gateway.connectionState}</span></div>
                    <div>agent: <span className="text-foreground">{gateway.agentStatus}</span></div>
                    <div>session: <span className="text-foreground font-mono text-[10px]">{gateway.currentSessionId || 'none'}</span></div>
                  </div>
                </CardContent>
              </Card>
            </BentoGridItem>

            <BentoGridItem className="col-span-1">
              <Card>
                <CardContent className="p-3">
                  <div className="flex items-center gap-2 mb-3">
                    <Radio className="w-4 h-4 text-primary" />
                    <span className="text-xs font-semibold">Channels</span>
                  </div>
                  {gateway.channelStatuses.length === 0 ? (
                    <div className="text-xs text-muted-foreground">no channels configured</div>
                  ) : (
                    <div className="space-y-2">
                      {gateway.channelStatuses.map(ch => (
                        <div key={ch.channel} className="flex items-center gap-2 text-xs">
                          <span className="font-semibold">{ch.channel}</span>
                          <Badge
                            variant={ch.connected ? 'default' : ch.running ? 'outline' : 'destructive'}
                            className="text-[9px] h-4"
                          >
                            {ch.connected ? 'connected' : ch.running ? 'connecting' : 'stopped'}
                          </Badge>
                          {ch.accountId && <span className="text-[10px] text-muted-foreground">{ch.accountId}</span>}
                          {ch.lastError && <span className="text-[10px] text-destructive">{ch.lastError}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </BentoGridItem>

            <BentoGridItem className="col-span-1">
              <Card>
                <CardContent className="p-3">
                  <div className="flex items-center gap-2 mb-3">
                    <Database className="w-4 h-4 text-primary" />
                    <span className="text-xs font-semibold">Sessions</span>
                  </div>
                  {gateway.sessions.length === 0 ? (
                    <div className="text-xs text-muted-foreground">no sessions</div>
                  ) : (
                    <div className="space-y-1">
                      {gateway.sessions.slice(0, 10).map(s => (
                        <div
                          key={s.id}
                          className="flex items-center gap-2 text-[10px] cursor-pointer hover:text-foreground transition-colors"
                          style={{ color: s.id === gateway.currentSessionId ? undefined : 'var(--muted-foreground)' }}
                          onClick={() => gateway.setCurrentSessionId(s.id)}
                        >
                          <span className={`font-mono ${s.id === gateway.currentSessionId ? 'text-primary' : ''}`}>
                            {s.id.slice(0, 8)}
                          </span>
                          <span>{s.messageCount} msgs</span>
                          <span>{s.updatedAt}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </BentoGridItem>

            {statusData && (
              <BentoGridItem className="col-span-2">
                <Card>
                  <CardContent className="p-3">
                    <div className="flex items-center gap-2 mb-3">
                      <FileJson className="w-4 h-4 text-primary" />
                      <span className="text-xs font-semibold">Raw Status</span>
                    </div>
                    <pre className="whitespace-pre-wrap text-[11px] text-muted-foreground overflow-auto max-h-[300px]">
                      {JSON.stringify(statusData, null, 2)}
                    </pre>
                  </CardContent>
                </Card>
              </BentoGridItem>
            )}
          </BentoGrid>
        </div>
      </ScrollArea>
    </div>
  );
}
