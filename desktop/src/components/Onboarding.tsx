import { useState, useCallback, useEffect, useRef } from 'react';
import type { useGateway } from '../hooks/useGateway';
import { ProviderSetup } from './ProviderSetup';
import { AuroraBackground } from './aceternity/aurora-background';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Check, Loader2, Monitor, Hand, ChevronRight } from 'lucide-react';

type Props = {
  gateway: ReturnType<typeof useGateway>;
  onComplete: () => void;
};

type ProviderChoice = {
  provider: 'claude' | 'codex';
  method: 'oauth' | 'apikey';
};

type DetectResult = {
  claude: { installed: boolean; hasOAuth: boolean; hasApiKey: boolean };
  codex: { installed: boolean; hasAuth: boolean };
};

type Step = 'detecting' | 'ready' | 'choose' | 'auth' | 'success' | 'permissions';

const isMac = (window as any).electronAPI?.platform === 'darwin';

function goToPermissionsOrComplete(setStep: (s: Step) => void, onComplete: () => void) {
  if (isMac) {
    setStep('permissions');
  } else {
    onComplete();
  }
}

export function OnboardingOverlay({ gateway, onComplete }: Props) {
  const [step, setStep] = useState<Step>('detecting');
  const [choice, setChoice] = useState<ProviderChoice | null>(null);
  const [authInfo, setAuthInfo] = useState<{ method?: string; identity?: string } | null>(null);
  const [detectResult, setDetectResult] = useState<DetectResult | null>(null);
  const detectRan = useRef(false);

  // Fast detect on mount — calls provider.detect RPC (< 500ms)
  useEffect(() => {
    if (detectRan.current) return;
    detectRan.current = true;

    (async () => {
      try {
        const result = await gateway.detectProviders();
        setDetectResult(result);

        // Auto-detect: if Claude has OAuth tokens or API key, auto-set and go to ready
        if (result.claude.hasOAuth || result.claude.hasApiKey) {
          try { await gateway.setProvider('claude'); } catch { /* continue */ }
          setAuthInfo({
            method: result.claude.hasOAuth ? 'oauth' : 'api_key',
            identity: result.claude.hasOAuth ? 'Claude subscription' : 'API key',
          });
          setStep('ready');
          return;
        }

        // If Codex has auth, auto-set codex
        if (result.codex.hasAuth) {
          try { await gateway.setProvider('codex'); } catch { /* continue */ }
          setAuthInfo({ method: 'api_key', identity: 'OpenAI' });
          setStep('ready');
          return;
        }

        // No auth found — show choose screen
        setStep('choose');
      } catch {
        // Gateway not connected yet or RPC failed — fall back to choose
        setStep('choose');
      }
    })();
  }, [gateway]);

  // Auto-advance from ready step after 1.2s
  useEffect(() => {
    if (step !== 'ready') return;
    const timer = setTimeout(() => goToPermissionsOrComplete(setStep, onComplete), 1200);
    return () => clearTimeout(timer);
  }, [step, onComplete]);

  const handleChoice = useCallback(async (c: ProviderChoice) => {
    setChoice(c);
    try {
      await gateway.setProvider(c.provider);
    } catch { /* continue */ }
    setStep('auth');
  }, [gateway]);

  const handleAuthSuccess = useCallback(async () => {
    try {
      const status = await gateway.getProviderStatus();
      if (status?.auth) {
        setAuthInfo({
          method: status.auth.method,
          identity: status.auth.identity,
        });
      }
    } catch { /* show generic success */ }
    setStep('success');
    setTimeout(() => goToPermissionsOrComplete(setStep, onComplete), 1200);
  }, [onComplete, gateway]);

  const handleSkip = useCallback(() => {
    onComplete();
  }, [onComplete]);

  return (
    <div className="fixed inset-0 z-50 bg-background">
      <AuroraBackground className="w-full h-full">
        <div className="flex items-center justify-center w-full h-full">
          <div className="w-full max-w-sm px-6">
            {step === 'detecting' && <DetectingStep />}

            {step === 'ready' && <ReadyStep authInfo={authInfo} />}

            {step === 'choose' && (
              <ChooseStep
                onChoice={handleChoice}
                onSkip={handleSkip}
                detect={detectResult}
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

            {step === 'permissions' && <PermissionsStep onComplete={onComplete} />}
          </div>
        </div>
      </AuroraBackground>
    </div>
  );
}

function DetectingStep() {
  return (
    <div className="flex flex-col items-center gap-3 py-8">
      <div className="relative w-20 h-20 mx-auto">
        <div className="absolute inset-0 rounded-full bg-success/30 blur-xl animate-pulse" />
        <img src="./dorabot-computer.png" alt="dorabot" className="relative w-20 h-20 dorabot-alive" />
      </div>
      <Loader2 className="w-5 h-5 text-primary animate-spin" />
      <div className="text-[11px] text-muted-foreground">checking for existing login...</div>
    </div>
  );
}

function ReadyStep({ authInfo }: { authInfo: { method?: string; identity?: string } | null }) {
  const label = authInfo?.identity || (authInfo?.method === 'oauth' ? 'Claude subscription' : 'API key');
  return (
    <div className="flex flex-col items-center gap-3 py-8">
      <div className="w-12 h-12 rounded-full bg-success/20 flex items-center justify-center">
        <Check className="w-6 h-6 text-success" />
      </div>
      <div className="text-sm font-semibold text-foreground">connected via {label}</div>
    </div>
  );
}

function DetectionBadge({ type }: { type: 'logged-in' | 'installed' }) {
  if (type === 'logged-in') {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-medium bg-success/15 text-success">
        <span className="w-1.5 h-1.5 rounded-full bg-success" />
        logged in
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-medium bg-warning/15 text-warning">
      <span className="w-1.5 h-1.5 rounded-full bg-warning" />
      installed
    </span>
  );
}

function ChooseStep({
  onChoice,
  onSkip,
  detect,
}: {
  onChoice: (c: ProviderChoice) => void;
  onSkip: () => void;
  detect: DetectResult | null;
}) {
  const claudeLoggedIn = detect?.claude.hasOAuth || detect?.claude.hasApiKey;
  const claudeInstalled = detect?.claude.installed;
  const codexLoggedIn = detect?.codex.hasAuth;

  return (
    <div className="space-y-5">
      {/* Logo + greeting */}
      <div className="text-center space-y-3">
        <div className="relative w-20 h-20 mx-auto">
          <div className="absolute inset-0 rounded-full bg-success/30 blur-xl animate-pulse" />
          <img src="./dorabot-computer.png" alt="dorabot" className="relative w-20 h-20 dorabot-alive" />
        </div>
        <div>
          <h1 className="text-base font-semibold text-foreground">welcome to dorabot</h1>
          <p className="text-[11px] text-muted-foreground mt-1">choose how to connect your AI</p>
        </div>
      </div>

      {/* Provider + method cards */}
      <div className="space-y-2">
        {/* Claude Code */}
        <button
          onClick={() => onChoice({ provider: 'claude', method: 'oauth' })}
          className="flex items-start gap-3 w-full px-4 py-3 rounded-xl border-2 border-border bg-card/80 backdrop-blur hover:border-primary/50 hover:bg-card transition-all text-left"
        >
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
            <img src="./claude-icon.svg" alt="Claude" className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-foreground">Claude Code</span>
              {claudeLoggedIn && <DetectionBadge type="logged-in" />}
              {!claudeLoggedIn && claudeInstalled && <DetectionBadge type="installed" />}
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">Use your Claude subscription or Anthropic API key</div>
          </div>
        </button>

        {/* Codex with ChatGPT login */}
        <button
          onClick={() => onChoice({ provider: 'codex', method: 'oauth' })}
          className="flex items-start gap-3 w-full px-4 py-3 rounded-xl border-2 border-border bg-card/80 backdrop-blur hover:border-primary/50 hover:bg-card transition-all text-left"
        >
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
            <img src="./openai-icon.svg" alt="OpenAI" className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-foreground">Sign in with ChatGPT</span>
              {codexLoggedIn && <DetectionBadge type="logged-in" />}
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">Use your OpenAI account (ChatGPT Plus required)</div>
          </div>
        </button>

        {/* OpenAI API key */}
        <button
          onClick={() => onChoice({ provider: 'codex', method: 'apikey' })}
          className="flex items-start gap-3 w-full px-4 py-3 rounded-xl border-2 border-border bg-card/80 backdrop-blur hover:border-primary/50 hover:bg-card transition-all text-left"
        >
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
            <img src="./openai-icon.svg" alt="OpenAI" className="w-5 h-5" />
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

function SuccessStep({ authInfo }: { authInfo: { method?: string; identity?: string } | null }) {
  const methodLabel = authInfo?.method === 'oauth'
    ? 'Claude subscription'
    : authInfo?.method === 'api_key'
    ? 'API key'
    : null;

  return (
    <div className="flex flex-col items-center gap-3 py-8">
      <div className="w-12 h-12 rounded-full bg-success/20 flex items-center justify-center">
        <Check className="w-6 h-6 text-success" />
      </div>
      <div className="text-sm font-semibold text-foreground">you're all set!</div>
      {methodLabel && (
        <div className="text-[10px] text-muted-foreground text-center">
          <div>connected via {methodLabel}</div>
        </div>
      )}
    </div>
  );
}

const MAC_PERMISSIONS = [
  {
    id: 'screen-recording',
    label: 'Screen Recording',
    description: 'lets dorabot take screenshots of your screen',
    icon: Monitor,
    settingsUrl: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  },
  {
    id: 'accessibility',
    label: 'Accessibility',
    description: 'lets dorabot manage windows, control apps, and automate your Mac',
    icon: Hand,
    settingsUrl: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  },
];

function PermissionsStep({ onComplete }: { onComplete: () => void }) {
  const openSettings = (url: string) => {
    const api = (window as any).electronAPI;
    if (api?.openExternal) {
      api.openExternal(url);
    }
  };

  return (
    <div className="space-y-5">
      <div className="text-center space-y-2">
        <div className="relative w-20 h-20 mx-auto">
          <div className="absolute inset-0 rounded-full bg-success/30 blur-xl animate-pulse" />
          <img src="./dorabot-computer.png" alt="dorabot" className="relative w-20 h-20 dorabot-alive" />
        </div>
        <div>
          <h1 className="text-base font-semibold text-foreground">one more thing</h1>
          <p className="text-[11px] text-muted-foreground mt-1">
            grant these macOS permissions so dorabot can use all its tools
          </p>
        </div>
      </div>

      <div className="space-y-2">
        {MAC_PERMISSIONS.map(perm => (
          <button
            key={perm.id}
            onClick={() => openSettings(perm.settingsUrl)}
            className="flex items-start gap-3 w-full px-4 py-3 rounded-xl border-2 border-border bg-card/80 backdrop-blur hover:border-primary/50 hover:bg-card transition-all text-left group"
          >
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
              <perm.icon className="w-4 h-4 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-foreground">{perm.label}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">{perm.description}</div>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary shrink-0 mt-1 transition-colors" />
          </button>
        ))}
      </div>

      <div className="text-[10px] text-muted-foreground bg-muted/50 rounded-lg px-3 py-2 text-center">
        add <strong>dorabot</strong> (or your terminal) in each section of System Settings &gt; Privacy &amp; Security
      </div>

      <div className="flex flex-col items-center gap-2">
        <Button size="sm" className="w-full h-8 text-xs" onClick={onComplete}>
          done
        </Button>
        <button
          onClick={onComplete}
          className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
        >
          i'll do this later
        </button>
      </div>
    </div>
  );
}
