import { useState, useCallback } from 'react';
import type { useGateway } from '../hooks/useGateway';
import { ProviderSetup } from './ProviderSetup';
import { AuroraBackground } from './aceternity/aurora-background';
import { Card, CardContent } from '@/components/ui/card';
import { Brain, Sparkles, Key, Check } from 'lucide-react';

type Props = {
  gateway: ReturnType<typeof useGateway>;
  onComplete: () => void;
};

type ProviderChoice = {
  provider: 'claude' | 'codex';
  method: 'oauth' | 'apikey';
};

type Step = 'choose' | 'auth' | 'success';

export function OnboardingOverlay({ gateway, onComplete }: Props) {
  const [step, setStep] = useState<Step>('choose');
  const [choice, setChoice] = useState<ProviderChoice | null>(null);

  const handleChoice = useCallback(async (c: ProviderChoice) => {
    setChoice(c);
    try {
      await gateway.setProvider(c.provider);
    } catch {
      // continue anyway
    }
    setStep('auth');
  }, [gateway]);

  const handleAuthSuccess = useCallback(() => {
    setStep('success');
    setTimeout(onComplete, 800);
  }, [onComplete]);

  const handleSkip = useCallback(() => {
    onComplete();
  }, [onComplete]);

  return (
    <div className="fixed inset-0 z-50">
      <AuroraBackground className="w-full h-full">
        <div className="flex items-center justify-center w-full h-full">
          <div className="w-full max-w-sm px-6">
            {step === 'choose' && (
              <ChooseStep onChoice={handleChoice} onSkip={handleSkip} />
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

            {step === 'success' && <SuccessStep />}
          </div>
        </div>
      </AuroraBackground>
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

        {/* Claude Code with API key */}
        <button
          onClick={() => onChoice({ provider: 'claude', method: 'apikey' })}
          className="flex items-start gap-3 w-full px-4 py-3 rounded-xl border-2 border-border bg-card/80 backdrop-blur hover:border-primary/50 hover:bg-card transition-all text-left"
        >
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
            <Brain className="w-4 h-4 text-primary" />
          </div>
          <div>
            <div className="text-xs font-semibold text-foreground">Claude Code (Anthropic)</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">Use your Anthropic API key</div>
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

function SuccessStep() {
  return (
    <div className="flex flex-col items-center gap-3 py-8">
      <div className="w-12 h-12 rounded-full bg-success/20 flex items-center justify-center">
        <Check className="w-6 h-6 text-success" />
      </div>
      <div className="text-sm font-semibold text-foreground">you're all set!</div>
    </div>
  );
}
