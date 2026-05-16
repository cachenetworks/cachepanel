'use client';

import * as React from 'react';
import { Archive, Cloud, Download, Loader2, Plus, Settings as SettingsIcon, Trash2 } from 'lucide-react';
import { Card, CardBody, CardHeader, CardSubtitle, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toaster';

interface BackupRow {
  filename: string;
  size: number;
  createdAt: string;
}

interface BackupsResponse {
  backups: BackupRow[];
  s3Configured: boolean;
  s3Bucket: string | null;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function BackupsCard({ isOwner }: { isOwner: boolean }) {
  const { toast } = useToast();
  const [state, setState] = React.useState<BackupsResponse | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [uploadOnCreate, setUploadOnCreate] = React.useState(false);
  const [showS3Modal, setShowS3Modal] = React.useState(false);

  const load = React.useCallback(async () => {
    if (!isOwner) return;
    try {
      const res = await fetch('/api/backups', { cache: 'no-store' });
      if (!res.ok) throw new Error(await res.text());
      const body = await res.json();
      setState(body);
    } catch (err) {
      toast({ variant: 'error', title: 'Failed to load backups', description: err instanceof Error ? err.message : String(err) });
    }
  }, [isOwner, toast]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const backups = state?.backups ?? null;

  async function create() {
    setCreating(true);
    try {
      const res = await fetch('/api/backups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadToS3: uploadOnCreate && state?.s3Configured }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 207) {
        toast({ variant: 'error', title: 'Saved locally, S3 upload failed', description: body.s3Error });
      } else if (!res.ok) {
        throw new Error(body.error ?? 'Failed');
      } else {
        const desc = body.s3 ? `${body.filename} (also uploaded to S3)` : body.filename;
        toast({ variant: 'success', title: 'Backup created', description: desc });
      }
      void load();
    } catch (err) {
      toast({ variant: 'error', title: 'Backup failed', description: err instanceof Error ? err.message : String(err) });
    } finally {
      setCreating(false);
    }
  }

  async function remove(name: string) {
    if (!confirm(`Delete backup "${name}"? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/backups/${encodeURIComponent(name)}`, { method: 'DELETE' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Failed');
      toast({ variant: 'success', title: 'Backup deleted' });
      void load();
    } catch (err) {
      toast({ variant: 'error', title: 'Delete failed', description: err instanceof Error ? err.message : String(err) });
    }
  }

  if (!isOwner) {
    return (
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Backups</CardTitle>
            <CardSubtitle>OWNER-only</CardSubtitle>
          </div>
          <Archive className="h-4 w-4 text-white/30" />
        </CardHeader>
        <CardBody>
          <p className="rounded-md border border-white/10 bg-white/[0.02] p-2 text-xs text-white/50">
            Backups are OWNER-only.
          </p>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Backups</CardTitle>
          <CardSubtitle>Snapshot the SQLite DB + secrets directory</CardSubtitle>
        </div>
        <Archive className="h-4 w-4 text-neon-magenta" />
      </CardHeader>
      <CardBody>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-white/55">
            Stored under <code>/app/data/backups/</code>. Download or push to S3-compatible storage.
          </p>
          <div className="flex items-center gap-2">
            {state?.s3Configured ? (
              <label className="flex items-center gap-1.5 text-[11px] text-white/70">
                <input
                  type="checkbox"
                  checked={uploadOnCreate}
                  onChange={(e) => setUploadOnCreate(e.target.checked)}
                />
                Also upload to <strong>{state.s3Bucket}</strong>
              </label>
            ) : null}
            <Button variant="outline" onClick={() => setShowS3Modal(true)}>
              <Cloud className="h-3.5 w-3.5" />
              {state?.s3Configured ? 'S3 configured' : 'Configure S3'}
            </Button>
            <Button onClick={create} disabled={creating}>
              {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              {creating ? 'Backing up…' : 'Create backup'}
            </Button>
          </div>
        </div>
        {backups === null ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : backups.length === 0 ? (
          <p className="rounded-md border border-white/10 bg-white/[0.02] p-3 text-xs text-white/55">
            No backups yet. Click "Create backup" — typically takes a couple seconds.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {backups.map((b) => (
              <li key={b.filename} className="flex items-center gap-3 rounded-md border border-white/5 bg-white/[0.02] px-3 py-2">
                <Archive className="h-4 w-4 text-white/40" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-xs text-white/85">{b.filename}</div>
                  <div className="text-[10px] text-white/40">
                    {formatBytes(b.size)} · {new Date(b.createdAt).toLocaleString()}
                  </div>
                </div>
                <a
                  href={`/api/backups/${encodeURIComponent(b.filename)}`}
                  className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-[11px] text-white/70 hover:border-white/25 hover:text-white"
                >
                  <Download className="h-3 w-3" />
                  Download
                </a>
                <button
                  onClick={() => remove(b.filename)}
                  className="inline-flex items-center gap-1 rounded-md border border-red-500/30 px-2 py-1 text-[11px] text-red-300 hover:bg-red-500/10"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
      {showS3Modal ? (
        <S3ConfigModal
          onClose={() => setShowS3Modal(false)}
          onSaved={() => {
            setShowS3Modal(false);
            void load();
          }}
        />
      ) : null}
    </Card>
  );
}

function S3ConfigModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [endpoint, setEndpoint] = React.useState('');
  const [region, setRegion] = React.useState('auto');
  const [bucket, setBucket] = React.useState('');
  const [accessKey, setAccessKey] = React.useState('');
  const [secretKey, setSecretKey] = React.useState('');
  const [prefix, setPrefix] = React.useState('cachepanel/');
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    (async () => {
      const res = await fetch('/api/backups/s3-config', { cache: 'no-store' });
      if (res.ok) {
        const body = await res.json();
        if (body.configured) {
          setEndpoint(body.endpoint);
          setRegion(body.region);
          setBucket(body.bucket);
          setPrefix(body.prefix);
        }
      }
    })();
  }, []);

  async function save() {
    if (!endpoint || !bucket || !accessKey || !secretKey) {
      toast({ variant: 'error', title: 'All fields except prefix are required' });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/backups/s3-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint, region, bucket, accessKey, secretKey, prefix }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? 'Save failed');
      }
      toast({ variant: 'success', title: 'S3 configured' });
      onSaved();
    } catch (err) {
      toast({ variant: 'error', title: 'Save failed', description: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-neon-magenta/30 bg-bg-1 p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="flex items-center gap-2 text-base font-semibold text-white">
          <SettingsIcon className="h-4 w-4 text-neon-magenta" />
          S3-compatible storage
        </h3>
        <p className="mt-1 text-xs text-white/55">
          Works with AWS S3, Cloudflare R2, Backblaze B2 (S3-compatible endpoint), MinIO, Wasabi.
        </p>
        <div className="mt-4 space-y-2">
          <Field label="Endpoint URL"><input className="cp-input" value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="https://s3.us-east-1.amazonaws.com" /></Field>
          <Field label="Region"><input className="cp-input" value={region} onChange={(e) => setRegion(e.target.value)} placeholder="us-east-1 (R2: 'auto')" /></Field>
          <Field label="Bucket"><input className="cp-input" value={bucket} onChange={(e) => setBucket(e.target.value)} /></Field>
          <Field label="Access key"><input className="cp-input" value={accessKey} onChange={(e) => setAccessKey(e.target.value)} /></Field>
          <Field label="Secret key (write-only)"><input type="password" className="cp-input" value={secretKey} onChange={(e) => setSecretKey(e.target.value)} placeholder="(re-enter to update)" /></Field>
          <Field label="Key prefix (optional)"><input className="cp-input" value={prefix} onChange={(e) => setPrefix(e.target.value)} /></Field>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </div>
        <style jsx>{`
          .cp-input {
            width: 100%;
            border-radius: 0.375rem;
            border: 1px solid rgba(255,255,255,0.1);
            background: rgba(255,255,255,0.03);
            padding: 0.5rem 0.75rem;
            font-size: 0.75rem;
            color: white;
            font-family: ui-monospace, monospace;
          }
          .cp-input:focus {
            border-color: rgba(230, 0, 255, 0.5);
            outline: none;
          }
        `}</style>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wider text-white/55">{label}</span>
      <div className="mt-0.5">{children}</div>
    </label>
  );
}
