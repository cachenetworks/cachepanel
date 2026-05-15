'use client';

import * as React from 'react';
import { Download, RefreshCw, Search, ShieldAlert, Trash2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty';
import { useToast } from '@/components/ui/toaster';
import { formatRelative } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface Log {
  id: string;
  createdAt: string;
  action: string;
  target: string | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  user: { username: string; avatar: string | null; discordId: string } | null;
}

const actionTone: Record<string, 'green' | 'red' | 'magenta' | 'yellow' | 'neutral' | 'blue'> = {
  'login.success': 'green',
  'login.failed': 'red',
  'user.pending_created': 'yellow',
  'user.approved': 'green',
  'user.disabled': 'red',
  'user.role_changed': 'magenta',
  'user.deleted': 'red',
  'terminal.session_opened': 'green',
  'terminal.session_closed': 'neutral',
  'terminal.command': 'blue',
  'file.uploaded': 'green',
  'file.edited': 'green',
  'file.deleted': 'red',
  'file.renamed': 'yellow',
  'file.created': 'green',
  'settings.changed': 'magenta',
};

export function AuditClient({ role }: { role: 'OWNER' | 'ADMIN' }) {
  const { toast } = useToast();
  const [logs, setLogs] = React.useState<Log[] | null>(null);
  const [filter, setFilter] = React.useState('');
  const [confirmClear, setConfirmClear] = React.useState(false);
  const [refreshKey, setRefreshKey] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const params = new URLSearchParams();
        if (filter.trim()) params.set('action', filter.trim());
        const res = await fetch(`/api/audit?${params.toString()}`, { cache: 'no-store' });
        if (!res.ok) throw new Error(await res.text());
        const body = (await res.json()) as { logs: Log[] };
        if (!cancelled) setLogs(body.logs);
      } catch (err) {
        if (!cancelled) {
          toast({ variant: 'error', title: 'Failed to load audit log', description: err instanceof Error ? err.message : String(err) });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [filter, refreshKey, toast]);

  async function clearAll() {
    try {
      const res = await fetch('/api/audit/clear', { method: 'POST' });
      if (!res.ok) throw new Error(await res.text());
      toast({ variant: 'success', title: 'Audit log cleared' });
      setConfirmClear(false);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      toast({ variant: 'error', title: 'Clear failed', description: err instanceof Error ? err.message : String(err) });
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-white">Audit log</h1>
          <p className="text-xs text-white/50">{role === 'OWNER' ? 'OWNER can export and clear logs.' : 'Read-only.'}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setRefreshKey((k) => k + 1)}>
            <RefreshCw className="h-3 w-3" />
            Refresh
          </Button>
          {role === 'OWNER' ? (
            <>
              <Button variant="outline" size="sm" asChild>
                <a href="/api/audit/export">
                  <Download className="h-3 w-3" />
                  Export CSV
                </a>
              </Button>
              <Button variant="danger" size="sm" onClick={() => setConfirmClear(true)}>
                <Trash2 className="h-3 w-3" />
                Clear
              </Button>
            </>
          ) : null}
        </div>
      </div>

      <Card className="p-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/40" />
          <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by action, e.g. file.deleted" className="pl-9" />
        </div>
      </Card>

      <Card className="p-0">
        {logs === null ? (
          <div className="space-y-2 p-5">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : logs.length === 0 ? (
          <EmptyState icon={<ShieldAlert className="h-8 w-8" />} title="No events" description="Audit events will appear here as users act on the panel." />
        ) : (
          <div className="divide-y divide-white/[0.04]">
            <div className="grid grid-cols-[180px_140px_1fr_120px] gap-3 px-5 py-3 text-[10px] uppercase tracking-wider text-white/40">
              <div>Time</div>
              <div>User</div>
              <div>Event</div>
              <div>IP</div>
            </div>
            {logs.map((l) => (
              <div key={l.id} className="grid grid-cols-[180px_140px_1fr_120px] items-center gap-3 px-5 py-2.5 text-sm hover:bg-white/[0.03]">
                <div className="text-xs text-white/50">{new Date(l.createdAt).toLocaleString()}</div>
                <div className="flex min-w-0 items-center gap-2">
                  <Avatar src={l.user?.avatar ?? null} fallback={l.user?.username ?? '?'} size={22} />
                  <span className="truncate text-white/80">{l.user?.username ?? '—'}</span>
                </div>
                <div className="flex min-w-0 items-center gap-2 text-xs">
                  <Badge tone={actionTone[l.action] ?? 'neutral'}>{l.action}</Badge>
                  {l.target ? <span className="truncate text-white/60" title={l.target}>{l.target}</span> : null}
                </div>
                <div className="text-xs text-white/50">{l.ipAddress ?? '—'}</div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Dialog open={confirmClear} onOpenChange={setConfirmClear}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clear audit log?</DialogTitle>
            <DialogDescription>This will permanently delete every audit entry. This action cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmClear(false)}>Cancel</Button>
            <Button variant="danger" onClick={clearAll}>Delete all</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
