import { useState, useCallback, useEffect, useRef } from 'react';
import type { useGateway } from '../hooks/useGateway';
import { ProviderSetup } from './ProviderSetup';
import { AuroraBackground } from './aceternity/aurora-background';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Brain, Sparkles, Key, Check, Loader2, X } from 'lucide-react';

type Props = {
  gateway: ReturnType<typeof useGateway>;
  onComplete: () => void;
};

type ProviderChoice = {
  provider: 'claude' | 'codex';
  method: 'oauth' | 'apikey';
};

type Step = 'auto-detect' | 'choose' | 'auth' | 'detecting' | 'success';

export function OnboardingOverlay({ gateway, onComplete }: Props) {
  const [step, setStep] = useState<Step>('auto-detect');
  const [choice, setChoice] = useState<ProviderChoice | null>(null);
  const [authInfo, setAuthInfo] = useState<{ method?: string; identity?: string; model?: string } | null>(null);
  const [detectMessage, setDetectMessage] = useState('checking for existing login...');
  const autoDetectRan = useRef(false);

  // Auto-detect existing auth on mount
  useEffect(() => {
    if (autoDetectRan.current) return;
    autoDetectRan.current = true;

    (async () => {
      try {
        const status = await gateway.getProviderStatus();
        if (status?.auth?.authenticated) {
          setAuthInfo({
            method: status.auth.method,
            identity: status.auth.identity,
            model: status.auth.model,
          });
          setStep('success');
          setTimeout(onComplete, 1200);
          return;
        }
      } catch { /* no provider configured or probe failed */ }
      // Not auto-detected, show choices
      setStep('choose');
    })();
  }, [gateway, onComplete]);

  const handleChoice = useCallback(async (c: ProviderChoice) => {
    setChoice(c);
    try {
      await gateway.setProvider(c.provider);
    } catch {
      // continue anyway
    }

    // For Claude Code OAuth, try detecting existing session first
    if (c.provider === 'claude' && c.method === 'oauth') {
      setStep('detecting');
      setDetectMessage('detecting Claude session...');

      // Set a 15s timeout for the detect step
      const timeout = setTimeout(() => {
        setDetectMessage('no existing session found');
        setTimeout(() => {
          setChoice({ provider: 'claude', method: 'oauth' });
          setStep('auth');
        }, 800);
      }, 15000);

      try {
        const status = await gateway.getProviderStatus();
        clearTimeout(timeout);
        if (status?.auth?.authenticated) {
          setAuthInfo({
            method: status.auth.method,
            identity: status.auth.identity,
            model: status.auth.model,
          });
          setStep('success');
          setTimeout(onComplete, 1200);
          return;
        }
      } catch {
        clearTimeout(timeout);
      }

      // Not authenticated - go to auth step with explanation
      setChoice({ provider: 'claude', method: 'oauth' });
      setStep('auth');
      return;
    }

    setStep('auth');
  }, [gateway, onComplete]);

  const handleAuthSuccess = useCallback(async () => {
    // Fetch the final status to show rich info on success
    try {
      const status = await gateway.getProviderStatus();
      if (status?.auth) {
        setAuthInfo({
          method: status.auth.method,
          identity: status.auth.identity,
          model: status.auth.model,
        });
      }
    } catch { /* show generic success */ }
    setStep('success');
    setTimeout(onComplete, 1200);
  }, [onComplete, gateway]);

  const handleSkip = useCallback(() => {
    onComplete();
  }, [onComplete]);

  return (
    <div className="fixed inset-0 z-50">
      <AuroraBackground className="w-full h-full">
        <div className="flex items-center justify-center w-full h-full">
          <div className="w-full max-w-sm px-6">
            {step === 'auto-detect' && <AutoDetectStep />}

            {step === 'choose' && (
              <ChooseStep onChoice={handleChoice} onSkip={handleSkip} />
            )}

            {step === 'detecting' && (
              <DetectingStep
                message={detectMessage}
                onCancel={() => {
                  setChoice({ provider: 'claude', method: 'oauth' });
                  setStep('auth');
                }}
              />
            )}

            {step === 'auth' && choice && (
              <AuthStep
                choice={choice}
                gateway={gateway}
                onSuccess={handleAuthSuccess}
                onBack={() => setStep('choose')}
                onSkip={handleSkip}
              />
            )}

            {step === 'success' && <SuccessStep authInfo={authInfo} />}
          </div>
        </div>
      </AuroraBackground>
    </div>
  );
}

function AutoDetectStep() {
  return (
    <div className="flex flex-col items-center gap-3 py-8">
      <div className="relative w-20 h-20 mx-auto">
        <div className="absolute inset-0 rounded-full bg-success/30 blur-xl animate-pulse" />
        <img src="/dorabot-computer.png" alt="dorabot" className="relative w-20 h-20 dorabot-alive" />
      </div>
      <Loader2 className="w-5 h-5 text-primary animate-spin" />
      <div className="text-[11px] text-muted-foreground">checking for existing login...</div>
    </div>
  );
}

function ChooseStep({ onChoice, onSkip }: { onChoice: (c: ProviderChoice) => void; onSkip: () => void }) {
  return (
    <div className="space-y-5">
      {/* Logo + greeting */}
      <div className="text-center space-y-3">
        <div className="relative w-20 h-20 mx-auto">
          <div className="absolute inset-0 rounded-full bg-success/30 blur-xl animate-pulse" />
          <img src="/dorabot-computer.png" alt="dorabot" className="relative w-20 h-20 dorabot-alive" />
        </div>
        <div>
          <h1 className="text-base font-semibold text-foreground">welcome to dorabot</h1>
          <p className="text-[11px] text-muted-foreground mt-1">choose how to connect your AI</p>
        </div>
      </div>

      {/* Provider + method cards */}
      <div className="space-y-2">
        {/* Claude Code - detects existing OAuth or falls back to setup-token */}
        <button
          onClick={() => onChoice({ provider: 'claude', method: 'oauth' })}
          className="flex items-start gap-3 w-full px-4 py-3 rounded-xl border-2 border-border bg-card/80 backdrop-blur hover:border-primary/50 hover:bg-card transition-all text-left"
        >
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
            <Brain className="w-4 h-4 text-primary" />
          </div>
          <div>
            <div className="text-xs font-semibold text-foreground">Claude Code</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">Use your Claude subscription or Anthropic API key</div>
          </div>
        </button>

        {/* Codex with ChatGPT login */}
        <button
          onClick={() => onChoice({ provider: 'codex', method: 'oauth' })}
          className="flex items-start gap-3 w-full px-4 py-3 rounded-xl border-2 border-border bg-card/80 backdrop-blur hover:border-primary/50 hover:bg-card transition-all text-left"
        >
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
            <Sparkles className="w-4 h-4 text-primary" />
          </div>
          <div>
            <div className="text-xs font-semibold text-foreground">Sign in with ChatGPT</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">Use your OpenAI account (ChatGPT Plus required)</div>
          </div>
        </button>

        {/* OpenAI API key */}
        <button
          onClick={() => onChoice({ provider: 'codex', method: 'apikey' })}
          className="flex items-start gap-3 w-full px-4 py-3 rounded-xl border-2 border-border bg-card/80 backdrop-blur hover:border-primary/50 hover:bg-card transition-all text-left"
        >
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
            <Key className="w-4 h-4 text-primary" />
          </div>
          <div>
            <div className="text-xs font-semibold text-foreground">OpenAI API Key</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">Use your own OpenAI API key with Codex</div>
          </div>
        </button>
      </div>

      {/* Switchable later */}
      <div className="text-center space-y-1">
        <div className="text-[10px] text-muted-foreground">you can switch anytime in settings</div>
        <button
          onClick={onSkip}
          className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
        >
          skip for now
        </button>
      </div>
    </div>
  );
}

function DetectingStep({ message, onCancel }: { message: string; onCancel: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 py-8">
      <Loader2 className="w-8 h-8 text-primary animate-spin" />
      <div className="text-sm font-medium text-foreground">detecting Claude session...</div>
      <div className="text-[10px] text-muted-foreground">{message}</div>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 text-[10px] mt-2"
        onClick={onCancel}
      >
        <X className="w-3 h-3 mr-1" />
        cancel
      </Button>
    </div>
  );
}

function AuthStep({
  choice,
  gateway,
  onSuccess,
  onBack,
  onSkip,
}: {
  choice: ProviderChoice;
  gateway: ReturnType<typeof useGateway>;
  onSuccess: () => void;
  onBack: () => void;
  onSkip: () => void;
}) {
  return (
    <Card className="bg-card/80 backdrop-blur border-border">
      <CardContent className="p-5">
        <ProviderSetup
          provider={choice.provider}
          preferredMethod={choice.method}
          gateway={gateway}
          onSuccess={onSuccess}
          onBack={onBack}
        />

        <div className="text-center mt-4 pt-3 border-t border-border">
          <button
            onClick={onSkip}
            className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            skip for now
          </button>
        </div>
      </CardContent>
    </Card>
  );
}

function SuccessStep({ authInfo }: { authInfo: { method?: string; identity?: string; model?: string } | null }) {
  const methodLabel = authInfo?.method === 'oauth'
    ? 'Claude subscription'
    : authInfo?.method === 'api_key'
    ? 'API key'
    : null;

  // Extract short model name from full model string
  const modelShort = authInfo?.model
    ? authInfo.model.includes('opus') ? 'opus'
    : authInfo.model.includes('sonnet') ? 'sonnet'
    : authInfo.model.includes('haiku') ? 'haiku'
    : authInfo.model.split('-').slice(0, 2).join('-')
    : null;

  return (
    <div className="flex flex-col items-center gap-3 py-8">
      <div className="w-12 h-12 rounded-full bg-success/20 flex items-center justify-center">
        <Check className="w-6 h-6 text-success" />
      </div>
      <div className="text-sm font-semibold text-foreground">you're all set!</div>
      {(methodLabel || modelShort) && (
        <div className="text-[10px] text-muted-foreground text-center space-y-0.5">
          {methodLabel && <div>connected via {methodLabel}</div>}
          {modelShort && <div>model: {modelShort}</div>}
        </div>
      )}
    </div>
  );
}
