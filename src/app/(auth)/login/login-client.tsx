'use client';

import { signIn } from 'next-auth/react';
import { AlertCircle, ShieldCheck, Server, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CachePanelLogo } from '@/components/brand/logo';

const errorMessages: Record<string, string> = {
  disabled: 'Your account has been disabled by an OWNER.',
  AccessDenied: 'Access was denied. Discord guild or role check failed.',
  OAuthCallback: 'Discord callback failed. Verify your client ID/secret and callback URL.',
  Configuration: 'CachePanel is not fully configured. Contact your OWNER.',
};

export function LoginClient({ error, callbackUrl }: { error?: string; callbackUrl?: string }) {
  const message = error ? errorMessages[error] ?? decodeURIComponent(error) : null;

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4">
      <div className="pointer-events-none absolute inset-0 bg-grid-fade opacity-80" />
      <div className="relative w-full max-w-md">
        <div className="glass-strong relative overflow-hidden p-8">
          <div className="absolute -right-12 -top-12 h-40 w-40 rounded-full bg-neon-green/20 blur-3xl" />
          <div className="absolute -bottom-12 -left-12 h-40 w-40 rounded-full bg-neon-magenta/20 blur-3xl" />
          <div className="relative flex flex-col items-center text-center">
            <CachePanelLogo size={44} withText={false} />
            <h1 className="mt-4 text-3xl font-semibold tracking-tight text-white">
              Cache<span className="neon-text-green">Panel</span>
            </h1>
            <p className="mt-1 text-sm text-white/60">Secure server control, the Cache way.</p>
          </div>

          {message ? (
            <div className="relative mt-6 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{message}</span>
            </div>
          ) : null}

          <div className="relative mt-8 space-y-3">
            <Button
              size="lg"
              className="w-full"
              onClick={() => signIn('discord', { callbackUrl })}
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden>
                <path d="M20.317 4.369a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.249a18.27 18.27 0 0 0-5.487 0 12.51 12.51 0 0 0-.617-1.249.077.077 0 0 0-.079-.037 19.736 19.736 0 0 0-4.885 1.515.07.07 0 0 0-.032.027C.533 9.045-.32 13.58.099 18.057a.082.082 0 0 0 .031.056 19.9 19.9 0 0 0 5.992 3.029.077.077 0 0 0 .084-.027 14.09 14.09 0 0 0 1.226-1.994.075.075 0 0 0-.041-.104 13.07 13.07 0 0 1-1.872-.892.077.077 0 0 1-.008-.127c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.927 1.793 8.18 1.793 12.061 0a.073.073 0 0 1 .078.009c.121.099.246.198.373.292a.077.077 0 0 1-.006.127 12.298 12.298 0 0 1-1.873.891.076.076 0 0 0-.04.105c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.029.077.077 0 0 0 .032-.055c.5-5.177-.838-9.674-3.548-13.66a.061.061 0 0 0-.031-.028zM8.02 15.331c-1.182 0-2.156-1.085-2.156-2.419 0-1.333.955-2.418 2.156-2.418 1.21 0 2.175 1.094 2.156 2.418 0 1.334-.955 2.419-2.156 2.419zm7.974 0c-1.182 0-2.156-1.085-2.156-2.419 0-1.333.955-2.418 2.156-2.418 1.21 0 2.175 1.094 2.156 2.418 0 1.334-.946 2.419-2.156 2.419z" />
              </svg>
              Continue with Discord
            </Button>
            <p className="text-center text-[11px] text-white/40">
              First successful login becomes the OWNER. Future logins require approval.
            </p>
          </div>

          <div className="relative mt-8 grid grid-cols-3 gap-3 border-t border-white/5 pt-6 text-center text-[10px] uppercase tracking-wider text-white/40">
            <div className="flex flex-col items-center gap-1">
              <ShieldCheck className="h-4 w-4 text-neon-green" />
              <span>OAuth</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <Lock className="h-4 w-4 text-neon-magenta" />
              <span>Audit</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <Server className="h-4 w-4 text-neon-green" />
              <span>Local first</span>
            </div>
          </div>
        </div>
        <p className="mt-4 text-center text-[10px] uppercase tracking-[0.18em] text-white/30">
          CachePanel · self-hosted
        </p>
      </div>
    </div>
  );
}
