'use client';

import * as React from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ClipboardCopy,
  Container,
  Hammer,
  Loader2,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  TestTube,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toaster';
import { cn } from '@/lib/utils';

interface SetupResponse {
  keyName: string;
  publicKey: string;
  remoteCommand: string;
  sshCopyIdLine: string;
  hostname: string;
  port: number;
  remoteUser: string;
  name: string;
}

interface DockerCheck {
  ok: boolean;
  stage: 'connected' | 'no-docker' | 'permission-denied' | 'no-socket' | 'unknown' | 'ssh-failed';
  message: string;
  socketGid?: number;
  version?: string;
  fixHint?: string;
}

interface CreatedServer {
  id: string;
  name: string;
  hostname: string;
}

export function AddServerWizard({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const [step, setStep] = React.useState<1 | 2 | 3>(1);
  const [draft, setDraft] = React.useState({
    name: '',
    hostname: '',
    port: 22,
    remoteUser: 'root',
    tags: '',
    notes: '',
    // v1.8.0: explicit OS pick. "auto" runs uname-or-ver on finalize.
    os: 'auto' as 'auto' | 'linux' | 'windows',
  });
  const [setup, setSetup] = React.useState<SetupResponse | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [verifyError, setVerifyError] = React.useState<string | null>(null);
  const [dockerCheck, setDockerCheck] = React.useState<DockerCheck | null>(null);
  const [createdServer, setCreatedServer] = React.useState<CreatedServer | null>(null);
  const [reTesting, setReTesting] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      setStep(1);
      setSetup(null);
      setVerifyError(null);
      setDockerCheck(null);
      setCreatedServer(null);
      setReTesting(false);
    }
  }, [open]);

  async function reTestDocker() {
    if (!createdServer) return;
    setReTesting(true);
    try {
      const r = await fetch(`/api/servers/finalize?serverId=${encodeURIComponent(createdServer.id)}`);
      const body = await r.json();
      if (r.ok && body.dockerCheck) {
        setDockerCheck(body.dockerCheck);
      } else {
        toast({ variant: 'error', title: 'Re-test failed', description: body.error ?? `HTTP ${r.status}` });
      }
    } catch (err) {
      toast({ variant: 'error', title: 'Re-test failed', description: err instanceof Error ? err.message : String(err) });
    } finally {
      setReTesting(false);
    }
  }

  function copy(text: string) {
    navigator.clipboard.writeText(text).then(
      () => toast({ variant: 'success', title: 'Copied' }),
      () => toast({ variant: 'error', title: 'Copy failed' }),
    );
  }

  async function generateKey() {
    setBusy(true);
    try {
      const r = await fetch('/api/servers/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: draft.name.trim(),
          hostname: draft.hostname.trim(),
          port: draft.port,
          remoteUser: draft.remoteUser.trim(),
        }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? `Failed (${r.status})`);
      setSetup(body);
      setStep(2);
    } catch (err) {
      toast({ variant: 'error', title: 'Setup failed', description: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  async function verifyAndCreate() {
    if (!setup) return;
    setBusy(true);
    setVerifyError(null);
    try {
      const r = await fetch('/api/servers/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: draft.name.trim(),
          hostname: draft.hostname.trim(),
          port: draft.port,
          defaultUser: draft.remoteUser.trim(),
          keyName: setup.keyName,
          tags: draft.tags,
          notes: draft.notes,
          os: draft.os,
        }),
      });
      const body = await r.json();
      if (!r.ok) {
        setVerifyError(body.error ?? `Failed (${r.status})`);
        return;
      }
      toast({ variant: 'success', title: 'Server added', description: body.probe?.split('\n')[0] });
      if (body.server) {
        setCreatedServer({
          id: body.server.id,
          name: body.server.name,
          hostname: body.server.hostname,
        });
      }
      if (body.dockerCheck) setDockerCheck(body.dockerCheck);
      setStep(3);
      onCreated();
    } catch (err) {
      setVerifyError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-neon-magenta" />
            Add a new server — guided setup
          </DialogTitle>
          <DialogDescription>
            CachePanel will generate a dedicated SSH key for this server, you paste one command on the
            remote box, then CachePanel verifies the connection and saves the profile.
          </DialogDescription>
        </DialogHeader>

        <Stepper step={step} />

        {step === 1 ? (
          <Step1
            draft={draft}
            setDraft={setDraft}
            busy={busy}
            onNext={generateKey}
            onCancel={onClose}
          />
        ) : null}

        {step === 2 && setup ? (
          <Step2
            setup={setup}
            busy={busy}
            verifyError={verifyError}
            tags={draft.tags}
            setTags={(tags) => setDraft({ ...draft, tags })}
            notes={draft.notes}
            setNotes={(notes) => setDraft({ ...draft, notes })}
            onCopy={copy}
            onBack={() => setStep(1)}
            onVerify={verifyAndCreate}
          />
        ) : null}

        {step === 3 ? (
          <Step3
            onClose={onClose}
            dockerCheck={dockerCheck}
            createdServer={createdServer}
            onReTest={reTestDocker}
            reTesting={reTesting}
            onCopy={copy}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function Stepper({ step }: { step: 1 | 2 | 3 }) {
  const steps = [
    { n: 1, label: 'Server details' },
    { n: 2, label: 'Authorize key' },
    { n: 3, label: 'Done' },
  ];
  return (
    <div className="flex items-center gap-2 text-[11px]">
      {steps.map((s, i) => (
        <React.Fragment key={s.n}>
          <span
            className={cn(
              'flex items-center gap-1.5 rounded-full border px-2.5 py-0.5',
              step >= s.n
                ? 'border-neon-green/40 bg-neon-green/10 text-neon-green'
                : 'border-white/10 bg-white/[0.02] text-white/50',
            )}
          >
            <span
              className={cn(
                'inline-flex h-4 w-4 items-center justify-center rounded-full border text-[9px] font-bold',
                step > s.n
                  ? 'border-neon-green/60 bg-neon-green/30 text-neon-green'
                  : step === s.n
                    ? 'border-neon-green/40 bg-neon-green/20 text-neon-green'
                    : 'border-white/15 text-white/50',
              )}
            >
              {step > s.n ? '✓' : s.n}
            </span>
            {s.label}
          </span>
          {i < steps.length - 1 ? <span className="h-px w-4 bg-white/10" /> : null}
        </React.Fragment>
      ))}
    </div>
  );
}

function Step1({
  draft,
  setDraft,
  busy,
  onNext,
  onCancel,
}: {
  draft: { name: string; hostname: string; port: number; remoteUser: string; tags: string; notes: string; os: 'auto' | 'linux' | 'windows' };
  setDraft: React.Dispatch<React.SetStateAction<{ name: string; hostname: string; port: number; remoteUser: string; tags: string; notes: string; os: 'auto' | 'linux' | 'windows' }>>;
  busy: boolean;
  onNext: () => void;
  onCancel: () => void;
}) {
  const valid =
    /^[a-z0-9][a-z0-9_-]{0,62}[a-z0-9]?$/.test(draft.name.trim()) &&
    draft.hostname.trim().length > 0 &&
    draft.remoteUser.trim().length > 0 &&
    draft.port > 0;
  return (
    <>
      <div className="space-y-3">
        <Field label="Server name (used as a label here)">
          <Input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value.toLowerCase() })}
            placeholder="vps-us-east"
          />
          <p className="mt-1 text-[11px] text-white/40">
            Lowercase letters, digits, <code>_</code> and <code>-</code>.
          </p>
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <Field label="Hostname or IP">
              <Input
                value={draft.hostname}
                onChange={(e) => setDraft({ ...draft, hostname: e.target.value })}
                placeholder="vps.example.com"
                className="font-mono"
              />
            </Field>
          </div>
          <Field label="SSH port">
            <Input
              type="number"
              value={draft.port}
              onChange={(e) => setDraft({ ...draft, port: parseInt(e.target.value || '22', 10) })}
            />
          </Field>
        </div>
        <Field label={draft.os === 'windows' ? 'Windows user (local account)' : 'Linux user CachePanel will SSH as'}>
          <Input
            value={draft.remoteUser}
            onChange={(e) => setDraft({ ...draft, remoteUser: e.target.value })}
            placeholder={draft.os === 'windows' ? 'Administrator, cache…' : 'root, cache, ubuntu, deploy…'}
          />
          <p className="mt-1 text-[11px] text-white/40">
            This account must already exist on the remote box and be allowed to SSH in.
            {draft.os === 'windows' ? (
              <> Windows hosts need OpenSSH Server enabled (Settings → Apps → Optional Features → OpenSSH Server).</>
            ) : null}
          </p>
        </Field>
        <Field label="Operating system">
          <div className="flex gap-2">
            {(['auto', 'linux', 'windows'] as const).map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => setDraft({ ...draft, os: opt })}
                className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                  draft.os === opt
                    ? 'border-neon-magenta/50 bg-neon-magenta/10 text-neon-magenta'
                    : 'border-white/10 bg-white/[0.02] text-white/60 hover:border-white/20 hover:text-white'
                }`}
              >
                {opt === 'auto' ? 'Auto-detect' : opt === 'linux' ? 'Linux' : 'Windows'}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-white/40">
            Auto-detect runs <code>uname || ver</code> on first connect. Override if you know the
            answer (handy for OpenSSH-on-Windows where the default cmd shell trips the probe).
          </p>
        </Field>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button onClick={onNext} disabled={!valid || busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Hammer className="h-4 w-4" />}
          Generate key
          <ArrowRight className="h-4 w-4" />
        </Button>
      </DialogFooter>
    </>
  );
}

function Step2({
  setup,
  busy,
  verifyError,
  tags,
  setTags,
  notes,
  setNotes,
  onCopy,
  onBack,
  onVerify,
}: {
  setup: SetupResponse;
  busy: boolean;
  verifyError: string | null;
  tags: string;
  setTags: (v: string) => void;
  notes: string;
  setNotes: (v: string) => void;
  onCopy: (s: string) => void;
  onBack: () => void;
  onVerify: () => void;
}) {
  return (
    <>
      <div className="space-y-4">
        <div className="rounded-lg border border-neon-green/20 bg-neon-green/5 p-3 text-xs text-white/70">
          <div className="mb-1 flex items-center gap-1.5 text-neon-green">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span className="font-semibold uppercase tracking-wider text-[10px]">step A · paste this on the remote box</span>
          </div>
          SSH into <code className="font-mono">{setup.remoteUser}@{setup.hostname}</code> any way you can right now (your
          laptop, an existing tunnel, an iDRAC console — doesn&apos;t matter). Then paste:
          <CopyBlock label="One-liner that authorizes CachePanel" onCopy={onCopy} value={setup.remoteCommand} />
        </div>

        <details className="rounded-lg border border-white/5 bg-white/[0.02] p-3 text-xs">
          <summary className="cursor-pointer text-white/60">Or do it from your laptop using ssh-copy-id-style</summary>
          <CopyBlock
            label="Run this from a machine that already has SSH access"
            onCopy={onCopy}
            value={setup.sshCopyIdLine}
          />
        </details>

        <details className="rounded-lg border border-white/5 bg-white/[0.02] p-3 text-xs">
          <summary className="cursor-pointer text-white/60">Or copy the public key manually</summary>
          <CopyBlock label="Append this to ~/.ssh/authorized_keys" onCopy={onCopy} value={setup.publicKey} />
        </details>

        <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
          <div className="mb-2 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-white/40">
            <ShieldCheck className="h-3.5 w-3.5 text-neon-magenta" />
            step B · optional — tags &amp; notes
          </div>
          <div className="space-y-2">
            <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="tags (comma-separated)" />
            <Textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notes about this server (optional)"
              className="min-h-[60px]"
            />
          </div>
        </div>

        {verifyError ? (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
            <div className="font-semibold">Verification failed</div>
            <pre className="mt-1 whitespace-pre-wrap break-words font-mono">{verifyError}</pre>
            <p className="mt-2 text-white/50">
              Confirm you ran the command above on <code>{setup.hostname}</code> as <code>{setup.remoteUser}</code>, then try again.
            </p>
          </div>
        ) : null}
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onBack} disabled={busy}>
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <Button onClick={onVerify} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <TerminalSquare className="h-4 w-4" />}
          {busy ? 'Verifying…' : 'I did that — verify & save'}
        </Button>
      </DialogFooter>
    </>
  );
}

function Step3({
  onClose,
  dockerCheck,
  createdServer,
  onReTest,
  reTesting,
  onCopy,
}: {
  onClose: () => void;
  dockerCheck: DockerCheck | null;
  createdServer: CreatedServer | null;
  onReTest: () => void;
  reTesting: boolean;
  onCopy: (v: string) => void;
}) {
  return (
    <>
      <div className="flex flex-col items-center gap-3 py-4 text-center">
        <CheckCircle2 className="h-10 w-10 text-neon-green" />
        <div className="text-lg font-semibold text-white">
          Server added{createdServer ? ` — ${createdServer.name}` : ''}
        </div>
        <p className="max-w-md text-sm text-white/60">
          Switch to it from the server picker in the top-right. To grant individual panel users
          their own Linux account on this server, head to{' '}
          <span className="text-neon-green">Users → Manage SSH access</span>.
        </p>
      </div>

      <DockerCheckPanel
        check={dockerCheck}
        server={createdServer}
        onReTest={onReTest}
        reTesting={reTesting}
        onCopy={onCopy}
      />

      <DialogFooter>
        <Button onClick={onClose}>Done</Button>
      </DialogFooter>
    </>
  );
}

function DockerCheckPanel({
  check,
  server,
  onReTest,
  reTesting,
  onCopy,
}: {
  check: DockerCheck | null;
  server: CreatedServer | null;
  onReTest: () => void;
  reTesting: boolean;
  onCopy: (v: string) => void;
}) {
  if (!check) return null;

  if (check.ok) {
    return (
      <div className="mt-2 flex items-start gap-2 rounded-md border border-neon-green/30 bg-neon-green/5 p-3 text-xs">
        <Container className="mt-0.5 h-4 w-4 shrink-0 text-neon-green" />
        <div className="flex-1">
          <div className="text-neon-green">{check.message}</div>
          <div className="mt-0.5 text-[11px] text-white/45">
            The panel can list containers, build images, and run docker-compose actions on this
            host.
          </div>
        </div>
      </div>
    );
  }

  // Failure — surface the fix hint as a copy-paste block + a re-test button.
  const stageLabel: Record<DockerCheck['stage'], string> = {
    connected: 'Connected',
    'no-docker': 'Docker not installed',
    'permission-denied': 'Permission denied',
    'no-socket': 'No Docker socket',
    unknown: 'Unknown error',
    'ssh-failed': 'SSH probe failed',
  };

  return (
    <div className="mt-2 rounded-md border border-yellow-500/40 bg-yellow-500/5 p-3 text-xs">
      <div className="flex items-start gap-2 text-yellow-200">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="flex-1">
          <div className="font-medium">Docker check: {stageLabel[check.stage]}</div>
          <div className="mt-0.5 text-white/65">{check.message}</div>
        </div>
      </div>

      {check.fixHint ? (
        <>
          <div className="mt-3 text-[10px] uppercase tracking-wider text-white/40">
            Run on {server?.hostname ?? 'the remote host'} as a sudoer
          </div>
          <div className="mt-1 flex items-start gap-2 rounded-md border border-white/10 bg-black/60 p-2">
            <pre className="flex-1 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] text-neon-green">
              {check.fixHint}
            </pre>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onCopy(check.fixHint!)}
              aria-label="Copy fix command"
            >
              <ClipboardCopy className="h-3 w-3" />
            </Button>
          </div>
          {check.stage === 'permission-denied' ? (
            <div className="mt-2 text-[11px] text-white/50">
              After running this, log out and back in on the remote box (or restart the SSH
              session) so the new group membership takes effect — then click <strong>Re-test</strong>.
            </div>
          ) : null}
        </>
      ) : null}

      <div className="mt-3 flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={onReTest} disabled={reTesting || !server}>
          {reTesting ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <TestTube className="h-3 w-3" />
          )}
          {reTesting ? 'Re-testing…' : 'Re-test Docker'}
        </Button>
        <span className="text-[11px] text-white/40">
          Server is saved either way. Docker access can be fixed any time from{' '}
          <span className="text-white/65">/admin/servers</span>.
        </span>
      </div>
    </div>
  );
}

function CopyBlock({ value, label, onCopy }: { value: string; label: string; onCopy: (v: string) => void }) {
  return (
    <div className="mt-2 rounded border border-white/10 bg-black/60 p-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wider text-white/40">{label}</span>
        <Button variant="ghost" size="sm" onClick={() => onCopy(value)}>
          <ClipboardCopy className="h-3 w-3" />
          Copy
        </Button>
      </div>
      <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] text-neon-green">
        {value}
      </pre>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-white/40">{label}</span>
      {children}
    </label>
  );
}
