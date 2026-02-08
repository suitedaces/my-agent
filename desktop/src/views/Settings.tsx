import { useCallback } from 'react';
import type { useGateway } from '../hooks/useGateway';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Shield, Brain, Globe, Settings2 } from 'lucide-react';

type Props = {
  gateway: ReturnType<typeof useGateway>;
};

export function SettingsView({ gateway }: Props) {
  const cfg = gateway.configData as Record<string, any> | null;
  const disabled = gateway.connectionState !== 'connected' || !cfg;

  const set = useCallback(async (key: string, value: unknown) => {
    try {
      await gateway.setConfig(key, value);
    } catch (err) {
      console.error(`failed to set ${key}:`, err);
    }
  }, [gateway]);

  const permissionMode = cfg?.permissionMode || 'default';
  const systemPromptMode = cfg?.systemPromptMode || 'full';
  const approvalMode = cfg?.security?.approvalMode || 'approve-sensitive';
  const browserEnabled = cfg?.browser?.enabled ?? false;
  const browserHeadless = cfg?.browser?.headless ?? false;

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border shrink-0">
        <Settings2 className="w-4 h-4 text-primary" />
        <span className="font-semibold text-sm">Settings</span>
        {disabled && <Badge variant="destructive" className="text-[9px] h-4">disconnected</Badge>}
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-4 space-y-4 max-w-lg">

          {/* permissions */}
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-4">
                <Shield className="w-4 h-4 text-primary" />
                <span className="text-xs font-semibold">Permissions & Approval</span>
              </div>

              <div className="space-y-4">
                <SettingRow label="permission mode" description="controls how the SDK handles tool permissions">
                  <Select value={permissionMode} onValueChange={v => set('permissionMode', v)} disabled={disabled}>
                    <SelectTrigger className="h-7 w-40 text-[11px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default" className="text-[11px]">default</SelectItem>
                      <SelectItem value="acceptEdits" className="text-[11px]">accept edits</SelectItem>
                      <SelectItem value="bypassPermissions" className="text-[11px]">bypass all</SelectItem>
                      <SelectItem value="plan" className="text-[11px]">plan only</SelectItem>
                      <SelectItem value="dontAsk" className="text-[11px]">don't ask</SelectItem>
                    </SelectContent>
                  </Select>
                </SettingRow>

                {permissionMode === 'bypassPermissions' && (
                  <div className="text-[10px] text-warning bg-warning/10 rounded px-2 py-1.5">
                    approval flow is disabled — agent auto-approves all tools
                  </div>
                )}

                <SettingRow label="approval mode" description="gateway-level tool classification">
                  <Select value={approvalMode} onValueChange={v => set('security.approvalMode', v)} disabled={disabled}>
                    <SelectTrigger className="h-7 w-40 text-[11px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="approve-sensitive" className="text-[11px]">approve sensitive</SelectItem>
                      <SelectItem value="autonomous" className="text-[11px]">autonomous</SelectItem>
                      <SelectItem value="lockdown" className="text-[11px]">lockdown</SelectItem>
                    </SelectContent>
                  </Select>
                </SettingRow>
              </div>
            </CardContent>
          </Card>

          {/* agent */}
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-4">
                <Brain className="w-4 h-4 text-primary" />
                <span className="text-xs font-semibold">Agent</span>
              </div>

              <div className="space-y-4">
                <SettingRow label="system prompt" description="how much system prompt context to include">
                  <Select value={systemPromptMode} onValueChange={v => set('systemPromptMode', v)} disabled={disabled}>
                    <SelectTrigger className="h-7 w-40 text-[11px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="full" className="text-[11px]">full</SelectItem>
                      <SelectItem value="minimal" className="text-[11px]">minimal</SelectItem>
                      <SelectItem value="none" className="text-[11px]">none</SelectItem>
                    </SelectContent>
                  </Select>
                </SettingRow>
              </div>
            </CardContent>
          </Card>

          {/* browser */}
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-4">
                <Globe className="w-4 h-4 text-primary" />
                <span className="text-xs font-semibold">Browser</span>
              </div>

              <div className="space-y-4">
                <SettingRow label="enabled" description="allow agent to control browser">
                  <Switch
                    size="sm"
                    checked={browserEnabled}
                    onCheckedChange={v => set('browser.enabled', v)}
                    disabled={disabled}
                  />
                </SettingRow>

                <SettingRow label="headless" description="run browser without visible window">
                  <Switch
                    size="sm"
                    checked={browserHeadless}
                    onCheckedChange={v => set('browser.headless', v)}
                    disabled={disabled}
                  />
                </SettingRow>
              </div>
            </CardContent>
          </Card>

          <div className="text-[10px] text-muted-foreground px-1">
            changes are saved to config and take effect on next agent run
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

function SettingRow({ label, description, children }: { label: string; description: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-medium text-foreground">{label}</div>
        <div className="text-[10px] text-muted-foreground">{description}</div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
