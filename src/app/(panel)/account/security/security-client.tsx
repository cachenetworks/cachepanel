'use client';

import * as React from 'react';
import { KeyRound, Plus, Trash2, ShieldAlert, ShieldCheck, Copy, Download } from 'lucide-react';
import { startRegistration, startAuthentication } from '@simplewebauthn/browser';
import { Card, CardHeader, CardTitle, CardSubtitle, CardBody } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toaster';
import type { PanelUser } from '@/lib/session';

interface Authenticator {
  id: string;
  nickname: string;
  transports: string;
  createdAt: string;
  lastUsedAt: string | null;
}

interface State {
  authenticators: Authenticator[];
  recoveryCodesRemaining: number;
  webAuthnAvailable: boolean;
  webAuthnReason: string | null;
}

export function SecurityClient({
  user,
  webAuthnAvailable,
  webAuthnReason,
}: {
  user: PanelUser;
  webAuthnAvailable: boolean;
  webAuthnReason: string | null;
}) {
  const { toast } = useToast();
  const [data, setData] = React.useState<State | null>(null);
  const [enrolling, setEnrolling] = React.useState(false);
  const [nickname, setNickname] = React.useState('');
  const [showCodes, setShowCodes] = React.useState<string[] | null>(null);

  const load = React.useCallback(async () => {
    try {
      const res = await fetch('/api/account/authenticators', { cache: 'no-store' });
      if (!res.ok) throw new Error(await res.text());
      setData(await res.json());
    } catch (err) {
      toast({ variant: 'error', title: 'Failed to load', description: err instanceof Error ? err.message : String(err) });
    }
  }, [toast]);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function enroll() {
    if (!nickname.trim()) {
      toast({ variant: 'error', title: 'Give the key a nickname first' });
      return;
    }
    setEnrolling(true);
    try {
      const optRes = await fetch('/api/auth/webauthn/register/options', { method: 'POST' });
      if (!optRes.ok) throw new Error((await optRes.json()).error ?? 'options failed');
      const options = await optRes.json();
      const attResp = await startRegistration({ optionsJSON: options });
      const verifyRes = await fetch('/api/auth/webauthn/register/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: nickname.trim(), response: attResp }),
      });
      const verifyBody = await verifyRes.json();
      if (!verifyRes.ok) throw new Error(verifyBody.error ?? 'verification failed');
      toast({ variant: 'success', title: 'Security key enrolled' });
      if (verifyBody.recoveryCodes) setShowCodes(verifyBody.recoveryCodes as string[]);
      setNickname('');
      void load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Browsers throw with cryptic messages — translate the common ones.
      let friendly = msg;
      if (msg.includes('NotAllowedError')) friendly = 'Enrollment cancelled or timed out.';
      else if (msg.includes('InvalidStateError')) friendly = 'This key is already enrolled.';
      toast({ variant: 'error', title: 'Enrollment failed', description: friendly });
    } finally {
      setEnrolling(false);
    }
  }

  async function remove(id: string, name: string) {
    if (!confirm(`Remove "${name}"? You'll need another key or a recovery code to sign sensitive actions afterwards.`)) return;
    try {
      const res = await fetch(`/api/account/authenticators/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json()).error ?? 'failed');
      toast({ variant: 'success', title: 'Key removed' });
      void load();
    } catch (err) {
      toast({ variant: 'error', title: 'Remove failed', description: err instanceof Error ? err.message : String(err) });
    }
  }

  async function testVerify() {
    try {
      const optRes = await fetch('/api/auth/webauthn/login/options', { method: 'POST' });
      if (!optRes.ok) throw new Error((await optRes.json()).error ?? 'options failed');
      const options = await optRes.json();
      const assertion = await startAuthentication({ optionsJSON: options });
      const res = await fetch('/api/auth/webauthn/login/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response: assertion }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'verify failed');
      toast({ variant: 'success', title: 'This browser is now trusted for 12h' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast({ variant: 'error', title: 'Verification failed', description: msg.includes('NotAllowedError') ? 'Cancelled or timed out.' : msg });
    }
  }

  function copyCodes() {
    if (!showCodes) return;
    navigator.clipboard.writeText(showCodes.join('\n')).catch(() => undefined);
    toast({ variant: 'success', title: 'Copied 10 codes to clipboard' });
  }

  function downloadCodes() {
    if (!showCodes) return;
    const blob = new Blob([showCodes.join('\n') + '\n'], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cachepanel-recovery-${user.username}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-white">Account security</h1>
        <p className="text-xs text-white/50">
          Add a hardware security key or platform authenticator (Touch ID, Windows Hello) to protect
          sensitive actions on this panel.
        </p>
      </div>

      {!webAuthnAvailable ? (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>2FA unavailable on this install</CardTitle>
              <CardSubtitle>HTTPS required</CardSubtitle>
            </div>
            <ShieldAlert className="h-4 w-4 text-yellow-400" />
          </CardHeader>
          <CardBody>
            <div className="rounded-md border border-yellow-500/30 bg-yellow-500/10 p-3 text-xs text-yellow-100">
              {webAuthnReason ?? 'WebAuthn requires HTTPS.'}
            </div>
            <p className="mt-2 text-[11px] text-white/45">
              Put the panel behind a Cloudflare Tunnel or a reverse proxy with TLS to enable
              security keys.
            </p>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Your security keys</CardTitle>
            <CardSubtitle>{data ? `${data.authenticators.length} registered` : 'Loading…'}</CardSubtitle>
          </div>
          {data && data.authenticators.length > 0 ? (
            <Badge tone="green">
              <ShieldCheck className="h-3 w-3" /> 2FA on
            </Badge>
          ) : (
            <Badge tone="magenta">
              <ShieldAlert className="h-3 w-3" /> 2FA off
            </Badge>
          )}
        </CardHeader>
        <CardBody>
          {!data ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : data.authenticators.length === 0 ? (
            <p className="rounded-md border border-white/10 bg-white/[0.02] p-3 text-xs text-white/55">
              You have no security keys registered. Without 2FA, any browser session logged in via
              Discord can change settings.
            </p>
          ) : (
            <ul className="space-y-2">
              {data.authenticators.map((a) => (
                <li key={a.id} className="flex items-center gap-3 rounded-md border border-white/5 bg-white/[0.02] p-3">
                  <KeyRound className="h-4 w-4 text-neon-magenta" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-white">{a.nickname}</div>
                    <div className="text-[11px] text-white/40">
                      Added {new Date(a.createdAt).toLocaleDateString()} ·{' '}
                      {a.lastUsedAt ? `last used ${new Date(a.lastUsedAt).toLocaleString()}` : 'never used'}
                    </div>
                  </div>
                  <Button variant="outline" onClick={() => remove(a.id, a.nickname)}>
                    <Trash2 className="h-3.5 w-3.5" />
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {webAuthnAvailable ? (
            <div className="mt-4 flex flex-col gap-2 border-t border-white/5 pt-4 sm:flex-row">
              <input
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="Nickname (e.g. YubiKey 5C, MacBook Touch ID)"
                className="flex-1 rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-neon-magenta/50 focus:outline-none"
              />
              <Button onClick={enroll} disabled={enrolling}>
                <Plus className="h-4 w-4" />
                {enrolling ? 'Touch your key…' : 'Add security key'}
              </Button>
              {data && data.authenticators.length > 0 ? (
                <Button variant="outline" onClick={testVerify}>
                  Test verify
                </Button>
              ) : null}
            </div>
          ) : null}
        </CardBody>
      </Card>

      {data && data.authenticators.length > 0 ? (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Recovery codes</CardTitle>
              <CardSubtitle>{data.recoveryCodesRemaining} unused</CardSubtitle>
            </div>
          </CardHeader>
          <CardBody>
            <p className="text-xs text-white/55">
              One-time codes you can use to sign in if you lose every security key. Treat them like
              passwords. New codes are generated automatically the first time you add a key — if
              you remove every key and re-enroll, a fresh set will be issued.
            </p>
          </CardBody>
        </Card>
      ) : null}

      {showCodes ? (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4"
          onClick={() => setShowCodes(null)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-neon-magenta/30 bg-bg-1 p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-white">Save your recovery codes</h3>
            <p className="mt-1 text-xs text-white/55">
              Each code is single-use. You will not see them again — store them in a password
              manager or print them.
            </p>
            <pre className="mt-4 grid grid-cols-2 gap-1 rounded-md border border-white/10 bg-black/40 p-3 font-mono text-xs text-neon-green">
              {showCodes.map((c) => (
                <span key={c}>{c}</span>
              ))}
            </pre>
            <div className="mt-4 flex gap-2">
              <Button variant="outline" onClick={copyCodes}>
                <Copy className="h-3.5 w-3.5" />
                Copy
              </Button>
              <Button variant="outline" onClick={downloadCodes}>
                <Download className="h-3.5 w-3.5" />
                Download
              </Button>
              <Button className="ml-auto" onClick={() => setShowCodes(null)}>
                Done — I saved them
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
