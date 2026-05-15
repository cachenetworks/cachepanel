'use client';

import * as React from 'react';
import {
  AlertTriangle,
  Box,
  Cpu,
  FileText,
  MemoryStick,
  MoreVertical,
  Pause,
  Play,
  Power,
  RefreshCw,
  RotateCw,
  Square,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/components/ui/toaster';
import { formatBytes, formatRelative } from '@/lib/utils';
import { useServer, withServer } from '@/components/layout/server-context';

interface ContainerPort {
  private: number;
  public: number | null;
  type: string;
  ip: string | null;
}

interface Container {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  createdAt: string;
  ports: ContainerPort[];
  cpuPct: number;
  memUsed: number;
  memLimit: number;
}

interface DockerInfo {
  available: boolean;
  containers: number;
  running: number;
  images: number;
  serverVersion?: string | null;
  error?: string | null;
}

type ActionVerb = 'start' | 'stop' | 'restart' | 'pause' | 'unpause' | 'kill' | 'remove';

export function DockerClient() {
  const { toast } = useToast();
  const { current } = useServer();
  const serverId = current?.id ?? null;
  const [info, setInfo] = React.useState<DockerInfo | null>(null);
  const [containers, setContainers] = React.useState<Container[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [refreshKey, setRefreshKey] = React.useState(0);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = React.useState<Container | null>(null);
  const [logsFor, setLogsFor] = React.useState<Container | null>(null);
  const [logsText, setLogsText] = React.useState('');
  const [logsLoading, setLogsLoading] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const res = await fetch(withServer('/api/docker', serverId), { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Failed (${res.status})`);
      setContainers(body.containers);
      setInfo(body.info);
      setError(body.info?.error ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [serverId]);

  React.useEffect(() => {
    let cancelled = false;
    // Clear stale data when the active server changes.
    setContainers(null);
    setInfo(null);
    const tick = async () => {
      if (cancelled) return;
      await load();
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [load, refreshKey, serverId]);

  function renderPort(p: ContainerPort): string {
    const proto = p.type ? `/${p.type}` : '';
    if (p.public != null) return `${p.public}→${p.private}${proto}`;
    return `${p.private}${proto}`;
  }

  async function runAction(c: Container, action: ActionVerb, force = false) {
    setBusyId(c.id);
    try {
      const res = await fetch(withServer(`/api/docker/${c.id}/action`, serverId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, force }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Failed (${res.status})`);
      toast({ variant: 'success', title: `${action} → ${c.name}` });
      await load();
    } catch (err) {
      toast({
        variant: 'error',
        title: `${action} failed`,
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusyId(null);
    }
  }

  async function openLogs(c: Container) {
    setLogsFor(c);
    setLogsText('');
    setLogsLoading(true);
    try {
      const res = await fetch(withServer(`/api/docker/${c.id}/logs?tail=500`, serverId), { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Failed (${res.status})`);
      setLogsText(body.logs || '(no logs)');
    } catch (err) {
      setLogsText(`(error: ${err instanceof Error ? err.message : String(err)})`);
    } finally {
      setLogsLoading(false);
    }
  }

  async function refreshLogs() {
    if (logsFor) await openLogs(logsFor);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-white">
            <Box className="h-5 w-5 text-neon-green" />
            Docker
            {current && !current.isPrimary ? (
              <Badge tone="magenta">{current.name}</Badge>
            ) : null}
          </h1>
          <p className="text-xs text-white/50">
            {info?.available
              ? `${info.running} running · ${info.containers} total · ${info.images} images${info.serverVersion ? ' · Docker ' + info.serverVersion : ''}`
              : 'Live container view, refreshes every 5s.'}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setRefreshKey((k) => k + 1)}>
          <RefreshCw className="h-3 w-3" />
          Refresh
        </Button>
      </div>

      {error && !containers ? (
        <EmptyState
          icon={<AlertTriangle className="h-8 w-8" />}
          title="Docker is not reachable"
          description={error}
        />
      ) : null}

      <Card className="p-0">
        {containers === null ? (
          <div className="space-y-2 p-5">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : containers.length === 0 ? (
          <EmptyState
            icon={<Box className="h-8 w-8" />}
            title="No containers"
            description="Nothing's running here yet."
          />
        ) : (
          <div className="divide-y divide-white/[0.04]">
            <div className="grid grid-cols-[1.4fr_1.2fr_90px_100px_120px_120px_120px] gap-3 px-5 py-3 text-[10px] uppercase tracking-wider text-white/40">
              <div>Name</div>
              <div>Image</div>
              <div>State</div>
              <div>CPU</div>
              <div>Memory</div>
              <div>Ports</div>
              <div className="text-right">Actions</div>
            </div>
            {containers.map((c) => {
              const running = c.state === 'running';
              const paused = c.state === 'paused';
              return (
                <div
                  key={c.id}
                  className="grid grid-cols-[1.4fr_1.2fr_90px_100px_120px_120px_120px] items-center gap-3 px-5 py-3 hover:bg-white/[0.03]"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-white" title={c.name}>
                      {c.name}
                    </div>
                    <div className="text-[11px] text-white/40">
                      {c.id} · {formatRelative(c.createdAt)}
                    </div>
                  </div>
                  <div className="truncate font-mono text-xs text-white/70" title={c.image}>
                    {c.image}
                  </div>
                  <div>
                    <Badge
                      tone={running ? 'green' : c.state === 'exited' ? 'red' : 'yellow'}
                    >
                      {c.state}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-white/80">
                    <Cpu className="h-3 w-3 text-white/40" />
                    {running ? c.cpuPct.toFixed(1) + '%' : '—'}
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-white/80">
                    <MemoryStick className="h-3 w-3 text-white/40" />
                    {running && c.memLimit
                      ? `${formatBytes(c.memUsed)} / ${formatBytes(c.memLimit)}`
                      : '—'}
                  </div>
                  <div className="flex flex-wrap gap-1 text-[11px]">
                    {c.ports.length === 0 ? (
                      <span className="text-white/30">—</span>
                    ) : (
                      c.ports.slice(0, 4).map((p, idx) => (
                        <span
                          key={idx}
                          className="rounded border border-white/10 bg-white/[0.02] px-1.5 py-0.5 text-white/70"
                          title={p.ip ?? undefined}
                        >
                          {renderPort(p)}
                        </span>
                      ))
                    )}
                  </div>
                  <div className="flex items-center justify-end gap-1">
                    {running ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busyId === c.id}
                        onClick={() => runAction(c, 'restart')}
                        title="Restart"
                      >
                        <RotateCw className="h-3 w-3" />
                      </Button>
                    ) : (
                      <Button
                        variant="default"
                        size="sm"
                        disabled={busyId === c.id}
                        onClick={() => runAction(c, 'start')}
                        title="Start"
                      >
                        <Play className="h-3 w-3" />
                      </Button>
                    )}
                    {running ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busyId === c.id}
                        onClick={() => runAction(c, 'stop')}
                        title="Stop"
                      >
                        <Square className="h-3 w-3" />
                      </Button>
                    ) : null}
                    <DropdownMenu>
                      <DropdownMenuTrigger className="rounded p-1 text-white/40 hover:bg-white/10 hover:text-white">
                        <MoreVertical className="h-4 w-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openLogs(c)}>
                          <FileText className="h-4 w-4" />
                          View logs
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {running ? (
                          <DropdownMenuItem onClick={() => runAction(c, 'pause')}>
                            <Pause className="h-4 w-4" />
                            Pause
                          </DropdownMenuItem>
                        ) : null}
                        {paused ? (
                          <DropdownMenuItem onClick={() => runAction(c, 'unpause')}>
                            <Play className="h-4 w-4" />
                            Unpause
                          </DropdownMenuItem>
                        ) : null}
                        {running ? (
                          <DropdownMenuItem onClick={() => runAction(c, 'restart')}>
                            <RotateCw className="h-4 w-4" />
                            Restart
                          </DropdownMenuItem>
                        ) : null}
                        {running ? (
                          <DropdownMenuItem danger onClick={() => runAction(c, 'kill')}>
                            <Zap className="h-4 w-4" />
                            Kill (OWNER)
                          </DropdownMenuItem>
                        ) : null}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem danger onClick={() => setConfirmRemove(c)}>
                          <Trash2 className="h-4 w-4" />
                          Remove (OWNER)
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3 text-xs text-white/50">
        <strong className="text-white/70">Heads up:</strong> Container actions
        require <code className="mx-1 text-neon-green">/var/run/docker.sock</code> mounted
        read/write. Removing or killing containers is OWNER-only.
      </div>

      {/* Remove confirmation */}
      <Dialog open={!!confirmRemove} onOpenChange={(o) => !o && setConfirmRemove(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash2 className="h-4 w-4 text-red-400" />
              Remove container?
            </DialogTitle>
            <DialogDescription className="truncate">
              {confirmRemove?.name} ({confirmRemove?.id})
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
            The container is gone for good. Any anonymous volumes are deleted with it.
            Named volumes remain. If the container is running we&apos;ll need <strong>force</strong>.
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmRemove(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                const c = confirmRemove!;
                setConfirmRemove(null);
                await runAction(c, 'remove', c.state === 'running');
              }}
            >
              <Trash2 className="h-4 w-4" />
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Logs viewer */}
      <Dialog open={!!logsFor} onOpenChange={(o) => !o && (setLogsFor(null), setLogsText(''))}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-neon-green" />
              <span className="truncate">{logsFor?.name}</span>
              <Badge tone="neutral">last 500 lines</Badge>
            </DialogTitle>
            <DialogDescription className="truncate font-mono text-[11px]">
              {logsFor?.id} · {logsFor?.image}
            </DialogDescription>
          </DialogHeader>
          <pre className="h-[55vh] overflow-auto rounded-lg border border-white/10 bg-black/60 p-3 font-mono text-[11px] leading-relaxed text-white/80">
            {logsLoading ? 'Loading…' : logsText}
          </pre>
          <DialogFooter>
            <Button variant="ghost" onClick={() => (setLogsFor(null), setLogsText(''))}>
              <X className="h-4 w-4" />
              Close
            </Button>
            <Button onClick={refreshLogs}>
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
