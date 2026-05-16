'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowLeft, HardDrive, Loader2, Sparkles, Trash2 } from 'lucide-react';
import { Card, CardBody, CardHeader, CardSubtitle, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toaster';
import { useServer, withServer } from '@/components/layout/server-context';
import type { PanelUser } from '@/lib/session';

interface VolumeRow {
  name: string;
  driver: string;
  mountpoint: string;
  scope: string;
  inUse: boolean;
  sizeBytes: number | null;
}

interface DiskRow {
  type: string;
  total: string;
  active: string;
  size: string;
  reclaimable: string;
}

function fmt(n: number | null) {
  if (n === null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function CleanupClient({ user }: { user: PanelUser }) {
  const { toast } = useToast();
  const { current } = useServer();
  const serverId = current?.id ?? null;
  const canManage = user.role === 'OWNER' || user.role === 'ADMIN';

  const [volumes, setVolumes] = React.useState<VolumeRow[] | null>(null);
  const [disk, setDisk] = React.useState<DiskRow[] | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [output, setOutput] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const [v, d] = await Promise.all([
        fetch(withServer('/api/docker/volumes', serverId), { cache: 'no-store' }),
        fetch(withServer('/api/docker/disk', serverId), { cache: 'no-store' }),
      ]);
      if (!v.ok || !d.ok) throw new Error('load failed');
      setVolumes((await v.json()).volumes);
      setDisk((await d.json()).rows);
    } catch (err) {
      toast({ variant: 'error', title: 'Load failed', description: err instanceof Error ? err.message : String(err) });
    }
  }, [serverId, toast]);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function clean(action: string, opts: { volumeName?: string; force?: boolean } = {}) {
    if (!canManage) return;
    const confirmText: Record<string, string> = {
      'prune-images': 'Remove all unused Docker images?',
      'prune-volumes': 'Remove all unused Docker volumes? Data inside is GONE.',
      'prune-networks': 'Remove all unused Docker networks?',
      'prune-builder': 'Clear the Docker build cache?',
      'prune-all': 'NUKE all unused images/containers/volumes/networks? Data inside unused volumes is gone forever.',
      'remove-volume': `Remove volume "${opts.volumeName}"? Data inside is GONE.`,
    };
    if (!confirm(confirmText[action] ?? 'Proceed?')) return;
    setBusy(action);
    setOutput(null);
    try {
      const res = await fetch(withServer('/api/docker/volumes', serverId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...opts }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Failed');
      setOutput(body.output || '(no output)');
      toast({ variant: body.success ? 'success' : 'error', title: action, description: body.success ? 'done' : `exit ${body.exitCode}` });
      void load();
    } catch (err) {
      toast({ variant: 'error', title: action + ' failed', description: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <Link href="/docker" className="inline-flex items-center gap-1 text-xs text-white/50 hover:text-white">
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Docker
        </Link>
        <h1 className="mt-2 flex items-center gap-2 text-xl font-semibold tracking-tight text-white">
          <HardDrive className="h-5 w-5 text-neon-magenta" />
          Docker cleanup &amp; volumes
        </h1>
        <p className="text-xs text-white/50">
          Reclaim disk space with surgical prunes, or browse and remove specific volumes. All actions
          are audited.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Disk usage</CardTitle>
            <CardSubtitle><code>docker system df</code></CardSubtitle>
          </div>
        </CardHeader>
        <CardBody>
          {disk === null ? (
            <Skeleton className="h-20 w-full" />
          ) : disk.length === 0 ? (
            <p className="text-xs text-white/55">No data available.</p>
          ) : (
            <table className="w-full text-left text-xs text-white/80">
              <thead className="text-[10px] uppercase tracking-wider text-white/40">
                <tr>
                  <th className="py-1">Type</th>
                  <th className="py-1">Total</th>
                  <th className="py-1">Active</th>
                  <th className="py-1">Size</th>
                  <th className="py-1">Reclaimable</th>
                </tr>
              </thead>
              <tbody>
                {disk.map((r) => (
                  <tr key={r.type} className="border-t border-white/5">
                    <td className="py-1.5">{r.type}</td>
                    <td className="py-1.5">{r.total}</td>
                    <td className="py-1.5">{r.active}</td>
                    <td className="py-1.5">{r.size}</td>
                    <td className="py-1.5 text-neon-magenta">{r.reclaimable}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>

      {canManage ? (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Quick prunes</CardTitle>
              <CardSubtitle>everything below is irreversible</CardSubtitle>
            </div>
            <Sparkles className="h-4 w-4 text-neon-magenta" />
          </CardHeader>
          <CardBody>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <Button variant="outline" onClick={() => clean('prune-images')} disabled={busy !== null}>
                Prune unused images
              </Button>
              <Button variant="outline" onClick={() => clean('prune-volumes')} disabled={busy !== null}>
                Prune unused volumes
              </Button>
              <Button variant="outline" onClick={() => clean('prune-networks')} disabled={busy !== null}>
                Prune unused networks
              </Button>
              <Button variant="outline" onClick={() => clean('prune-builder')} disabled={busy !== null}>
                Clear build cache
              </Button>
              <Button variant="danger" onClick={() => clean('prune-all')} disabled={busy !== null}>
                <Trash2 className="h-3.5 w-3.5" />
                Nuke everything unused
              </Button>
            </div>
            {output ? (
              <pre className="mt-3 max-h-60 overflow-auto rounded-md border border-white/10 bg-black/60 p-2 font-mono text-[10px] text-white/85">
                {output}
              </pre>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Volumes</CardTitle>
            <CardSubtitle>{volumes ? `${volumes.length} total` : 'loading…'}</CardSubtitle>
          </div>
        </CardHeader>
        <CardBody>
          {volumes === null ? (
            <Skeleton className="h-32 w-full" />
          ) : volumes.length === 0 ? (
            <p className="text-xs text-white/55">No volumes on this server.</p>
          ) : (
            <ul className="space-y-1.5">
              {volumes.map((v) => (
                <li key={v.name} className="flex items-center gap-3 rounded-md border border-white/5 bg-white/[0.02] p-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-mono font-medium text-white">{v.name}</span>
                      {v.inUse ? <Badge tone="green">in use</Badge> : <Badge tone="yellow">unused</Badge>}
                      <span className="text-[10px] text-white/40">{v.driver}</span>
                    </div>
                    <div className="truncate font-mono text-[10px] text-white/45">{v.mountpoint}</div>
                  </div>
                  <span className="font-mono text-[11px] text-white/65">{fmt(v.sizeBytes)}</span>
                  {canManage ? (
                    <Button
                      variant="danger"
                      onClick={() => clean('remove-volume', { volumeName: v.name, force: v.inUse })}
                      disabled={busy !== null}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Remove{v.inUse ? ' (force)' : ''}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
