import { useState, useCallback } from 'react';
import type { useGateway } from '../hooks/useGateway';
import { ProviderSetup } from './ProviderSetup';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Check, X, ChevronDown, ChevronUp } from 'lucide-react';

type Props = {
  gateway: ReturnType<typeof useGateway>;
  disabled: boolean;
};

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

export function ProviderCard({ gateway, disabled }: Props) {
  const [showAuthSetup, setShowAuthSetup] = useState(false);
  const cfg = gateway.configData as Record<string, any> | null;
  const providerInfo = gateway.providerInfo;
  const providerName = (cfg?.provider?.name as string) || 'claude';
  const authenticated = providerInfo?.auth?.authenticated ?? false;
  const authMethod = providerInfo?.auth?.method;
  const authIdentity = providerInfo?.auth?.identity;
  const authModel = providerInfo?.auth?.model;
  const cliVersion = providerInfo?.auth?.cliVersion;

  const handleProviderChange = useCallback(async (name: string) => {
    try {
      const res = await gateway.setProvider(name);
      if (!res.auth.authenticated) {
        setShowAuthSetup(true);
      }
    } catch (err) {
      console.error('failed to switch provider:', err);
    }
  }, [gateway]);

  const handleAuthSuccess = useCallback(() => {
    setShowAuthSetup(false);
    gateway.getProviderStatus();
  }, [gateway]);

  // Model options per provider
  const claudeModels = [
    { value: 'claude-opus-4-6', label: 'opus' },
    { value: 'claude-sonnet-4-5-20250929', label: 'sonnet' },
    { value: 'claude-haiku-4-5-20251001', label: 'haiku' },
  ];

  const codexModels = [
    { value: 'gpt-5.3-codex', label: 'gpt-5.3-codex' },
    { value: 'gpt-5.2-codex', label: 'gpt-5.2-codex' },
    { value: 'gpt-5.1-codex-mini', label: 'gpt-5.1-codex-mini' },
    { value: 'gpt-5.1-codex-max', label: 'gpt-5.1-codex-max' },
    { value: 'gpt-5.2', label: 'gpt-5.2' },
    { value: 'gpt-5.1', label: 'gpt-5.1' },
    { value: 'gpt-5.1-codex', label: 'gpt-5.1-codex' },
    { value: 'gpt-5-codex', label: 'gpt-5-codex' },
    { value: 'gpt-5-codex-mini', label: 'gpt-5-codex-mini' },
    { value: 'gpt-5', label: 'gpt-5' },
  ];

  const currentModel = gateway.model || cfg?.model || 'claude-sonnet-4-5-20250929';
  const codexModel = cfg?.provider?.codex?.model || '';

  const handleCodexModelChange = useCallback(async (value: string) => {
    try {
      await gateway.setConfig('provider.codex.model', value);
    } catch (err) {
      console.error('failed to set codex model:', err);
    }
  }, [gateway]);

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-4">
          <img
            src={providerName === 'codex' ? './openai-icon.svg' : './claude-icon.svg'}
            alt={providerName}
            className="w-4 h-4"
          />
          <span className="text-xs font-semibold">Model</span>
          {authenticated ? (
            <Badge variant="outline" className="text-[9px] h-4 ml-auto text-success border-success/30">
              <Check className="w-2.5 h-2.5 mr-0.5" />
              connected
            </Badge>
          ) : (
            <Badge variant="destructive" className="text-[9px] h-4 ml-auto">
              not connected
            </Badge>
          )}
        </div>

        <div className="space-y-4">
          {/* Provider selector */}
          <SettingRow label="provider" description="which AI backend to use">
            <Select value={providerName} onValueChange={handleProviderChange} disabled={disabled}>
              <SelectTrigger className="h-7 w-40 text-[11px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="claude" className="text-[11px]">Claude (Anthropic)</SelectItem>
                <SelectItem value="codex" className="text-[11px]">OpenAI (Codex)</SelectItem>
              </SelectContent>
            </Select>
          </SettingRow>

          {/* Auth status */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[11px] font-medium text-foreground">authentication</div>
                <div className="text-[10px] text-muted-foreground">
                  {authenticated
                    ? `connected via ${authIdentity || (authMethod === 'oauth' ? 'Claude subscription' : 'API key')}`
                    : 'not authenticated'}
                </div>
                {authenticated && cliVersion && (
                  <div className="text-[9px] text-muted-foreground/60 font-mono">
                    CLI v{cliVersion}
                  </div>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-6 text-[10px] px-2"
                onClick={() => setShowAuthSetup(!showAuthSetup)}
                disabled={disabled}
              >
                {showAuthSetup ? 'cancel' : authenticated ? 'change' : 'set up'}
              </Button>
            </div>

            {showAuthSetup && (
              <div className="border border-border rounded-lg p-3 bg-secondary/30">
                <ProviderSetup
                  provider={providerName as 'claude' | 'codex'}
                  gateway={gateway}
                  onSuccess={handleAuthSuccess}
                  compact
                />
              </div>
            )}
          </div>

          {/* Model selector */}
          {providerName === 'claude' ? (
            <SettingRow label="model" description="default model for new chats">
              <Select value={currentModel} onValueChange={gateway.changeModel} disabled={disabled}>
                <SelectTrigger className="h-7 w-40 text-[11px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {claudeModels.map(m => (
                    <SelectItem key={m.value} value={m.value} className="text-[11px]">{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingRow>
          ) : (
            <SettingRow label="model" description="codex model for agent runs">
              <Select value={codexModel || 'gpt-5.3-codex'} onValueChange={handleCodexModelChange} disabled={disabled}>
                <SelectTrigger className="h-7 w-44 text-[11px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {codexModels.map(m => (
                    <SelectItem key={m.value} value={m.value} className="text-[11px]">{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingRow>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
