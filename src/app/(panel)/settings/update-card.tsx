'use client';

import * as React from 'react';
import { ArrowUpCircle, Loader2, RefreshCcw } from 'lucide-react';
import { Card, CardBody, CardHeader, CardSubtitle, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toaster';

interface UpdateStatus {
  current: { digest: string | null; version: string };
  remote: { digest: string | null; latestTag: string | null };
  updateAvailable: boolean;
  canApply: boolean;
  reason?: string;
}

export function UpdateCard({ isOwner }: { isOwner: boolean }) {
  const { toast } = useToast();
  const [status, setStatus] = React.useState<UpdateStatus | null>(null);
  const [checking, setChecking] = React.useState(false);
  const [applying, setApplying] = React.useState(false);

  const load = React.useCallback(async () => {
    setChecking(true);
    try {
      const res = await fetch('/api/panel/update', { cache: 'no-store' });
      if (!res.ok) throw new Error(await res.text());
      setStatus(await res.json());
    } catch (err) {
      toast({ variant: 'error', title: 'Check failed', description: err instanceof Error ? err.message : String(err) });
    } finally {
      setChecking(false);
    }
  }, [toast]);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function apply() {
    if (!confirm('Apply update? The panel will restart in ~30s.')) return;
    setApplying(true);
    try {
      const res = await fetch('/api/panel/update', { method: 'POST' });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed');
      toast({ variant: 'success', title: 'Update started', description: 'Refresh in 30s.' });
    } catch (err) {
      toast({ variant: 'error', title: 'Update failed', description: err instanceof Error ? err.message : String(err) });
    } finally {
      setApplying(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Panel updates</CardTitle>
          <CardSubtitle>
            {status ? `${status.current.version}${status.remote.latestTag ? ` · latest tag: ${status.remote.latestTag}` : ''}` : 'checking…'}
          </CardSubtitle>
        </div>
        {status?.updateAvailable ? (
          <Badge tone="magenta">update available</Badge>
        ) : status ? (
          <Badge tone="green">up to date</Badge>
        ) : null}
      </CardHeader>
      <CardBody>
        {!status ? (
          <Skeleton className="h-10 w-full" />
        ) : (
          <div className="space-y-2">
            <div className="rounded-md border border-white/5 bg-white/[0.02] p-2 font-mono text-[10px] text-white/55">
              local:  {status.current.digest ?? '(unknown)'}<br />
              remote: {status.remote.digest ?? '(unknown)'}
            </div>
            {status.reason ? (
              <p className="text-[11px] text-yellow-300">{status.reason}</p>
            ) : null}
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={load} disabled={checking}>
                {checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5" />}
                Re-check
              </Button>
              {isOwner && status.canApply ? (
                <Button onClick={apply} disabled={applying}>
                  {applying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUpCircle className="h-3.5 w-3.5" />}
                  {applying ? 'Updating…' : 'Apply update'}
                </Button>
              ) : null}
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
