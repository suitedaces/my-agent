import { useState, useCallback, useRef, useEffect } from 'react';
import type { useGateway } from '../hooks/useGateway';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ArrowLeft, ExternalLink, Loader2, AlertCircle } from 'lucide-react';

type Props = {
  provider: 'claude' | 'codex';
  gateway: ReturnType<typeof useGateway>;
  onSuccess: () => void;
  onBack?: () => void;
  compact?: boolean; // for settings inline mode
  preferredMethod?: 'oauth' | 'apikey'; // pre-selected method from onboarding
};

export function ProviderSetup({ provider, gateway, onSuccess, onBack, compact, preferredMethod }: Props) {
  if (provider === 'claude') {
    return <ClaudeSetup gateway={gateway} onSuccess={onSuccess} onBack={onBack} compact={compact} />;
  }
  return <CodexSetup gateway={gateway} onSuccess={onSuccess} onBack={onBack} compact={compact} preferredMethod={preferredMethod} />;
}

function ClaudeSetup({ gateway, onSuccess, onBack, compact }: Omit<Props, 'provider' | 'preferredMethod'>) {
  const [apiKey, setApiKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const isValid = apiKey.startsWith('sk-ant-') && apiKey.length > 20;

  const submit = useCallback(async () => {
    if (!isValid) return;
    setLoading(true);
    setError(null);
    try {
      const res = await gateway.authWithApiKey('claude', apiKey);
      if (res.authenticated) {
        onSuccess();
      } else {
        setError(res.error || 'Authentication failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to authenticate');
    } finally {
      setLoading(false);
    }
  }, [apiKey, isValid, gateway, onSuccess]);

  return (
    <div className="space-y-4">
      {!compact && onBack && (
        <button onClick={onBack} className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-3 h-3" />
          back
        </button>
      )}

      {!compact && (
        <div className="text-center space-y-1">
          <div className="text-sm font-semibold">Claude Code (Anthropic)</div>
          <div className="text-[11px] text-muted-foreground">enter your API key to get started</div>
        </div>
      )}

      <div className="space-y-2">
        <Input
          ref={inputRef}
          type="password"
          placeholder="sk-ant-..."
          value={apiKey}
          onChange={e => { setApiKey(e.target.value); setError(null); }}
          onKeyDown={e => e.key === 'Enter' && isValid && submit()}
          className="h-8 text-[11px] font-mono"
          disabled={loading}
        />

        {error && (
          <div className="flex items-center gap-1.5 text-[10px] text-destructive">
            <AlertCircle className="w-3 h-3 shrink-0" />
            {error}
          </div>
        )}

        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <span>get your key at</span>
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              const url = 'https://console.anthropic.com/settings/keys';
              (window as any).electronAPI?.openExternal?.(url) || window.open(url, '_blank');
            }}
            className="text-primary hover:underline inline-flex items-center gap-0.5"
          >
            console.anthropic.com
            <ExternalLink className="w-2.5 h-2.5" />
          </a>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          className="h-7 text-[11px] flex-1"
          onClick={submit}
          disabled={!isValid || loading}
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin mr-1.5" /> : null}
          {loading ? 'connecting...' : 'connect'}
        </Button>
      </div>

      {!compact && (
        <div className="text-[10px] text-muted-foreground text-center">
          stored locally, never leaves your machine
        </div>
      )}
    </div>
  );
}

type CodexProps = Omit<Props, 'provider'> & { preferredMethod?: 'oauth' | 'apikey' };

function CodexSetup({ gateway, onSuccess, onBack, compact, preferredMethod }: CodexProps) {
  // If preferredMethod is 'apikey', start directly in apikey mode
  const [mode, setMode] = useState<'choose' | 'oauth-waiting' | 'apikey'>(
    preferredMethod === 'apikey' ? 'apikey' : 'choose'
  );
  const [apiKey, setApiKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loginIdRef = useRef<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoStartedRef = useRef(false);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  // Auto-start OAuth if preferredMethod is 'oauth'
  useEffect(() => {
    if (preferredMethod === 'oauth' && !autoStartedRef.current) {
      autoStartedRef.current = true;
      startOAuth();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preferredMethod]);

  const startOAuth = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Check if codex binary is available
      const check = await gateway.checkProvider('codex');
      if (!check.ready && check.reason?.includes('binary not found')) {
        setError('Codex CLI not installed. Run: npm i -g @openai/codex');
        setLoading(false);
        return;
      }

      const { authUrl, loginId } = await gateway.startOAuth('codex');
      loginIdRef.current = loginId;
      setMode('oauth-waiting');

      // Open browser
      (window as any).electronAPI?.openExternal?.(authUrl) || window.open(authUrl, '_blank');

      // Poll for completion
      pollRef.current = setInterval(async () => {
        try {
          const res = await gateway.completeOAuth('codex', loginId);
          if (res.authenticated) {
            if (pollRef.current) clearInterval(pollRef.current);
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
            pollRef.current = null;
            setLoading(false);
            onSuccess();
          }
        } catch {
          // still waiting
        }
      }, 2000);

      // Timeout after 120s
      timeoutRef.current = setTimeout(() => {
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
        setLoading(false);
        setMode('choose');
        setError('Login timed out. Please try again.');
      }, 120_000);
    } catch (err) {
      setLoading(false);
      setError(err instanceof Error ? err.message : 'OAuth failed');
    }
  }, [gateway, onSuccess]);

  const submitApiKey = useCallback(async () => {
    if (!apiKey.startsWith('sk-') || apiKey.length < 20) return;
    setLoading(true);
    setError(null);
    try {
      const res = await gateway.authWithApiKey('codex', apiKey);
      if (res.authenticated) {
        onSuccess();
      } else {
        setError(res.error || 'Authentication failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to authenticate');
    } finally {
      setLoading(false);
    }
  }, [apiKey, gateway, onSuccess]);

  const cancelOAuth = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    pollRef.current = null;
    setLoading(false);
    setMode('choose');
  }, []);

  return (
    <div className="space-y-4">
      {!compact && onBack && (
        <button onClick={onBack} className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-3 h-3" />
          back
        </button>
      )}

      {!compact && (
        <div className="text-center space-y-1">
          <div className="text-sm font-semibold">OpenAI (Codex)</div>
          <div className="text-[11px] text-muted-foreground">
            {mode === 'apikey' ? 'enter your OpenAI API key' : 'sign in with ChatGPT or use an API key'}
          </div>
        </div>
      )}

      {mode === 'oauth-waiting' ? (
        <div className="flex flex-col items-center gap-3 py-4">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
          <div className="text-[11px] text-muted-foreground">waiting for login in browser...</div>
          <div className="text-[10px] text-muted-foreground">complete the sign-in in your browser</div>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-[10px]"
            onClick={cancelOAuth}
          >
            cancel
          </Button>
        </div>
      ) : mode === 'apikey' ? (
        // API key only mode (when user chose "OpenAI API Key" in onboarding)
        <>
          <div className="space-y-2">
            <Input
              type="password"
              placeholder="sk-..."
              value={apiKey}
              onChange={e => { setApiKey(e.target.value); setError(null); }}
              onKeyDown={e => e.key === 'Enter' && submitApiKey()}
              className="h-8 text-[11px] font-mono"
              disabled={loading}
              autoFocus
            />
            <Button
              size="sm"
              className="h-7 text-[11px] w-full"
              onClick={submitApiKey}
              disabled={!apiKey.startsWith('sk-') || apiKey.length < 20 || loading}
            >
              {loading ? <Loader2 className="w-3 h-3 animate-spin mr-1.5" /> : null}
              {loading ? 'connecting...' : 'connect'}
            </Button>
          </div>

          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <span>get your key at</span>
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                const url = 'https://platform.openai.com/api-keys';
                (window as any).electronAPI?.openExternal?.(url) || window.open(url, '_blank');
              }}
              className="text-primary hover:underline inline-flex items-center gap-0.5"
            >
              platform.openai.com
              <ExternalLink className="w-2.5 h-2.5" />
            </a>
          </div>

          {!compact && (
            <button
              onClick={() => setMode('choose')}
              className="text-[10px] text-muted-foreground hover:text-foreground transition-colors w-full text-center"
            >
              or sign in with ChatGPT instead
            </button>
          )}
        </>
      ) : (
        // Choose mode - OAuth button + API key fallback
        <>
          <Button
            size="sm"
            className="h-8 text-[11px] w-full"
            onClick={startOAuth}
            disabled={loading}
          >
            {loading ? <Loader2 className="w-3 h-3 animate-spin mr-1.5" /> : null}
            sign in with ChatGPT
          </Button>

          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <div className="flex-1 h-px bg-border" />
            or use an API key
            <div className="flex-1 h-px bg-border" />
          </div>

          <div className="space-y-2">
            <Input
              type="password"
              placeholder="sk-..."
              value={apiKey}
              onChange={e => { setApiKey(e.target.value); setError(null); }}
              onKeyDown={e => e.key === 'Enter' && submitApiKey()}
              className="h-8 text-[11px] font-mono"
              disabled={loading}
            />
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-[11px] w-full"
              onClick={submitApiKey}
              disabled={!apiKey.startsWith('sk-') || apiKey.length < 20 || loading}
            >
              connect with API key
            </Button>
          </div>
        </>
      )}

      {error && (
        <div className="flex items-center gap-1.5 text-[10px] text-destructive">
          <AlertCircle className="w-3 h-3 shrink-0" />
          {error}
        </div>
      )}

      {!compact && mode !== 'apikey' && (
        <div className="text-[10px] text-muted-foreground text-center">
          ChatGPT Plus subscription required for OAuth
        </div>
      )}
    </div>
  );
}
