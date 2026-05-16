'use client';

import * as React from 'react';
import { Archive, Download, Loader2, Plus, Trash2 } from 'lucide-react';
import { Card, CardBody, CardHeader, CardSubtitle, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toaster';

interface BackupRow {
  filename: string;
  size: number;
  createdAt: string;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function BackupsCard({ isOwner }: { isOwner: boolean }) {
  const { toast } = useToast();
  const [backups, setBackups] = React.useState<BackupRow[] | null>(null);
  const [creating, setCreating] = React.useState(false);

  const load = React.useCallback(async () => {
    if (!isOwner) return;
    try {
      const res = await fetch('/api/backups', { cache: 'no-store' });
      if (!res.ok) throw new Error(await res.text());
      const body = await res.json();
      setBackups(body.backups);
    } catch (err) {
      toast({ variant: 'error', title: 'Failed to load backups', description: err instanceof Error ? err.message : String(err) });
    }
  }, [isOwner, toast]);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    setCreating(true);
    try {
      const res = await fetch('/api/backups', { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Failed');
      toast({ variant: 'success', title: 'Backup created', description: body.filename });
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
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-xs text-white/55">
            Stored under <code>/app/data/backups/</code>. Download to keep them somewhere safe — they
            disappear if you wipe the container's data volume.
          </p>
          <Button onClick={create} disabled={creating}>
            {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            {creating ? 'Backing up…' : 'Create backup'}
          </Button>
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
    </Card>
  );
}
