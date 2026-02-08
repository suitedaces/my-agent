import { useMemo } from 'react';
import type { useGateway } from '../hooks/useGateway';
import { ChannelSecurity } from '../components/ChannelSecurity';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { FocusCards } from '@/components/aceternity/focus-cards';

type Props = {
  channel: 'whatsapp' | 'telegram';
  gateway: ReturnType<typeof useGateway>;
  onViewSession?: (sessionId: string, channel?: string, chatId?: string) => void;
};

export function ChannelView({ channel, gateway, onViewSession }: Props) {
  const status = gateway.channelStatuses.find(s => s.channel === channel);
  const messages = useMemo(
    () => gateway.channelMessages.filter(m => m.channel === channel),
    [gateway.channelMessages, channel]
  );

  const channelSessions = useMemo(
    () => gateway.sessions.filter(s => s.channel === channel),
    [gateway.sessions, channel]
  );

  const label = channel === 'whatsapp' ? 'WhatsApp' : 'Telegram';

  const statusBadge = () => {
    if (!status) return <Badge variant="outline">not configured</Badge>;
    if (status.connected) return <Badge className="bg-success/15 text-success border-success/30">connected</Badge>;
    if (status.running) return <Badge className="bg-warning/15 text-warning border-warning/30">connecting...</Badge>;
    return <Badge variant="destructive">disconnected</Badge>;
  };

  const formatTime = (ts: number) => {
    return new Date(ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
  };

  const grouped = useMemo(() => {
    const groups = new Map<string, typeof messages>();
    for (const msg of messages) {
      const list = groups.get(msg.chatId) || [];
      list.push(msg);
      groups.set(msg.chatId, list);
    }
    return Array.from(groups.entries());
  }, [messages]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border shrink-0">
        <span className="font-semibold text-sm">{label}</span>
        {statusBadge()}
        {status?.accountId && (
          <span className="text-muted-foreground text-[11px]">{status.accountId}</span>
        )}
        {status?.lastError && (
          <span className="text-destructive text-[11px]">{status.lastError}</span>
        )}
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-4 space-y-4">
          <ChannelSecurity channel={channel} gateway={gateway} />

          {channelSessions.length === 0 && messages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
              <div className="text-2xl opacity-40">{channel === 'whatsapp' ? 'W' : 'T'}</div>
              <div className="text-sm">no {label} conversations yet</div>
              <div className="text-[10px]">
                {!status ? `configure ${label} in your config to get started` :
                 status.connected ? 'waiting for incoming messages...' :
                 'channel is not connected'}
              </div>
            </div>
          )}

          {channelSessions.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground px-1 pb-2">conversations</div>
              <FocusCards>
                {channelSessions.map(s => (
                  <Card
                    key={s.id}
                    className="cursor-pointer hover:border-primary/50 transition-colors"
                    onClick={() => onViewSession?.(s.id, s.channel, s.chatId)}
                  >
                    <CardContent className="p-3">
                      <div className="text-primary text-xs font-semibold">
                        {s.senderName || s.chatId || s.id.slice(0, 16)}
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-1">
                        {s.messageCount} messages — last {new Date(s.updatedAt).toLocaleString()}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </FocusCards>
            </div>
          )}

          {grouped.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground px-1 pb-2">live feed</div>
              {grouped.map(([chatId, msgs]) => (
                <Card key={chatId} className="mb-3">
                  <CardContent className="p-3">
                    <div className="text-primary text-xs font-semibold">{msgs[0]?.senderName || chatId}</div>
                    <div className="text-[10px] text-muted-foreground">{chatId}</div>
                    <Separator className="my-2" />
                    <div className="space-y-2">
                      {msgs.slice(-10).map(msg => (
                        <div key={msg.id} className="border-b border-border/50 pb-2 last:border-0 last:pb-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-primary text-xs font-semibold">{msg.senderName || msg.senderId}</span>
                            <span className="text-[10px] text-muted-foreground">{formatTime(msg.timestamp)}</span>
                          </div>
                          <div className="text-xs text-muted-foreground">{msg.body}</div>
                          {msg.response && (
                            <div className="mt-1 pl-3 border-l-2 border-success text-xs text-foreground">{msg.response}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
