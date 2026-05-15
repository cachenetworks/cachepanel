'use client';

import * as React from 'react';
import {
  Activity,
  Box,
  Cpu,
  Microchip,
  HardDrive,
  MemoryStick,
  Server,
  Sparkles,
  TerminalSquare,
  FileEdit,
  Clock,
  Thermometer,
} from 'lucide-react';
import Link from 'next/link';
import { Card, CardBody, CardHeader, CardTitle, CardSubtitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Avatar } from '@/components/ui/avatar';
import { EmptyState } from '@/components/ui/empty';
import { formatBytes, formatRelative, formatUptime } from '@/lib/utils';
import { useServer, withServer } from '@/components/layout/server-context';

interface Gpu {
  vendor: string | null;
  model: string | null;
  driver: string | null;
  vramMb: number | null;
  vramUsedMb: number | null;
  vramFreeMb: number | null;
  loadPct: number | null;
  memLoadPct: number | null;
  tempC: number | null;
  powerW: number | null;
}

interface Stats {
  server: { id: string; name: string; hostname: string; isPrimary: boolean } | null;
  cpu: { load: number; cores: number; tempC: number | null };
  mem: { total: number; used: number; free: number };
  disk: { total: number; used: number; free: number };
  uptime: number;
  os: { platform: string; distro: string; release: string; kernel: string; arch: string; hostname: string };
  node: { version: string };
  gpus: Gpu[];
  docker: { available: boolean; containers?: number; running?: number; images?: number; serverVersion?: string | null; error?: string | null } | null;
  recentLogins: Array<{
    id: string;
    createdAt: string;
    action: string;
    target: string | null;
    user: { username: string; avatar: string | null; discordId: string } | null;
  }>;
  terminalSessions: Array<{
    id: string;
    startedAt: string;
    endedAt: string | null;
    status: string;
    user: { username: string; avatar: string | null } | null;
  }>;
  recentFileActions: Array<{
    id: string;
    action: string;
    path: string;
    createdAt: string;
    user: { username: string; avatar: string | null } | null;
  }>;
}

function StatCard({
  title,
  value,
  hint,
  icon,
  progress,
  tone,
}: {
  title: string;
  value: string;
  hint?: string;
  icon: React.ReactNode;
  progress?: number;
  tone?: 'green' | 'magenta';
}) {
  return (
    <Card>
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-white/40">{title}</div>
          <div className="mt-2 text-2xl font-semibold tracking-tight text-white">{value}</div>
          {hint ? <div className="mt-1 text-xs text-white/50">{hint}</div> : null}
        </div>
        <div
          className={
            tone === 'magenta'
              ? 'rounded-lg border border-neon-magenta/30 bg-neon-magenta/10 p-2 text-neon-magenta'
              : 'rounded-lg border border-neon-green/30 bg-neon-green/10 p-2 text-neon-green'
          }
        >
          {icon}
        </div>
      </div>
      {typeof progress === 'number' ? (
        <div className="mt-4">
          <Progress value={progress} tone={tone === 'magenta' ? 'magenta' : 'green'} />
        </div>
      ) : null}
    </Card>
  );
}

interface OllamaSnapshot {
  available: boolean;
  base: string;
  version?: string;
  defaultModel: string;
  models: Array<{ name: string }>;
  running: Array<{ name: string }>;
}

export function DashboardClient() {
  const { current } = useServer();
  const serverId = current?.id ?? null;
  const [stats, setStats] = React.useState<Stats | null>(null);
  const [ollama, setOllama] = React.useState<OllamaSnapshot | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Reset stats so the previous server's numbers don't flash while we fetch.
    setStats(null);
    const tick = async () => {
      try {
        const res = await fetch(withServer('/api/stats', serverId), { cache: 'no-store' });
        if (!res.ok) throw new Error(await res.text());
        const data = (await res.json()) as Stats;
        if (!cancelled) {
          setStats(data);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load stats');
      } finally {
        if (!cancelled) timer = setTimeout(tick, 4000);
      }
    };
    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [serverId]);

  React.useEffect(() => {
    let cancelled = false;
    // Reset so we don't briefly flash the old server's models.
    setOllama(null);
    const tick = async () => {
      try {
        const res = await fetch(withServer('/api/ollama', serverId), { cache: 'no-store' });
        if (!res.ok) return;
        const body = (await res.json()) as OllamaSnapshot;
        if (!cancelled) setOllama(body);
      } catch {
        /* swallow — dashboard handles offline state */
      }
    };
    tick();
    const id = setInterval(tick, 15_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [serverId]);

  if (error && !stats) {
    return (
      <EmptyState
        icon={<Server className="h-8 w-8" />}
        title="Could not load server stats"
        description={error}
      />
    );
  }

  if (!stats) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Card key={i}>
              <Skeleton className="h-3 w-20" />
              <Skeleton className="mt-4 h-8 w-28" />
              <Skeleton className="mt-4 h-2 w-full" />
            </Card>
          ))}
        </div>
      </div>
    );
  }

  const memPct = (stats.mem.used / Math.max(stats.mem.total, 1)) * 100;
  const diskPct = (stats.disk.used / Math.max(stats.disk.total, 1)) * 100;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-white">
          Dashboard
          {stats.server && !stats.server.isPrimary ? (
            <Badge tone="magenta">{stats.server.name}</Badge>
          ) : null}
        </h1>
        <p className="text-sm text-white/50">
          {stats.os.hostname || stats.server?.hostname || '—'}{' '}
          {(stats.os.distro || stats.os.platform) ? (
            <>
              <span className="text-white/30">·</span> {stats.os.distro || stats.os.platform} {stats.os.release}{' '}
            </>
          ) : null}
          {stats.os.kernel ? (
            <>
              <span className="text-white/30">·</span> Kernel {stats.os.kernel}
            </>
          ) : null}
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="CPU load"
          value={`${stats.cpu.load.toFixed(1)}%`}
          hint={`${stats.cpu.cores} cores`}
          icon={<Cpu className="h-4 w-4" />}
          progress={stats.cpu.load}
        />
        <StatCard
          title="Memory"
          value={`${formatBytes(stats.mem.used)} / ${formatBytes(stats.mem.total)}`}
          hint={`${formatBytes(stats.mem.free)} free`}
          icon={<MemoryStick className="h-4 w-4" />}
          progress={memPct}
          tone="magenta"
        />
        <StatCard
          title="Disk"
          value={`${formatBytes(stats.disk.used)} / ${formatBytes(stats.disk.total)}`}
          hint={`${formatBytes(stats.disk.free)} free`}
          icon={<HardDrive className="h-4 w-4" />}
          progress={diskPct}
        />
        <StatCard
          title="Uptime"
          value={formatUptime(stats.uptime)}
          hint={`Node ${stats.node.version} · ${stats.os.arch}`}
          icon={<Activity className="h-4 w-4" />}
          tone="magenta"
        />
      </div>

      {stats.gpus.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {stats.gpus.map((g, i) => (
            <Card key={i}>
              <CardHeader>
                <div>
                  <CardTitle>GPU {stats.gpus.length > 1 ? i + 1 : ''}</CardTitle>
                  <CardSubtitle>{[g.vendor, g.model].filter(Boolean).join(' · ') || 'Graphics adapter'}</CardSubtitle>
                </div>
                <div className="rounded-lg border border-neon-magenta/30 bg-neon-magenta/10 p-2 text-neon-magenta">
                  <Microchip className="h-4 w-4" />
                </div>
              </CardHeader>
              <CardBody>
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-[10px] uppercase tracking-wider text-white/40">Load</dt>
                    <dd className="mt-1 text-white">{g.loadPct != null ? `${g.loadPct.toFixed(0)}%` : '—'}</dd>
                    {g.loadPct != null ? <Progress value={g.loadPct} tone="magenta" className="mt-2" /> : null}
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase tracking-wider text-white/40">VRAM</dt>
                    <dd className="mt-1 text-white">
                      {g.vramUsedMb != null && g.vramMb
                        ? `${(g.vramUsedMb / 1024).toFixed(1)} / ${(g.vramMb / 1024).toFixed(1)} GB`
                        : g.vramMb
                          ? `${(g.vramMb / 1024).toFixed(1)} GB total`
                          : '—'}
                    </dd>
                    {g.vramUsedMb != null && g.vramMb ? (
                      <Progress value={(g.vramUsedMb / g.vramMb) * 100} tone="green" className="mt-2" />
                    ) : null}
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase tracking-wider text-white/40">
                      <Thermometer className="inline h-3 w-3" /> Temp
                    </dt>
                    <dd className="mt-1 text-white">{g.tempC != null ? `${g.tempC.toFixed(0)} °C` : '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase tracking-wider text-white/40">Power</dt>
                    <dd className="mt-1 text-white">{g.powerW != null ? `${g.powerW.toFixed(0)} W` : '—'}</dd>
                  </div>
                  {g.driver ? (
                    <div className="col-span-2">
                      <dt className="text-[10px] uppercase tracking-wider text-white/40">Driver</dt>
                      <dd className="mt-1 text-xs text-white/70">{g.driver}</dd>
                    </div>
                  ) : null}
                </dl>
              </CardBody>
            </Card>
          ))}
        </div>
      ) : null}

      <div className={stats.docker ? 'grid grid-cols-1 gap-4 lg:grid-cols-2' : 'grid grid-cols-1 gap-4'}>
        {stats.docker ? (
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Docker</CardTitle>
                <CardSubtitle>
                  {stats.docker.available
                    ? `${stats.docker.running} running · ${stats.docker.containers} total · ${stats.docker.images} images`
                    : 'Daemon not reachable'}
                </CardSubtitle>
              </div>
              <Link
                href="/docker"
                className="rounded-lg border border-neon-green/30 bg-neon-green/10 p-2 text-neon-green transition-colors hover:bg-neon-green/20"
                aria-label="Open Docker page"
              >
                <Box className="h-4 w-4" />
              </Link>
            </CardHeader>
            <CardBody>
              {stats.docker.available ? (
                <div className="flex items-center gap-3 text-sm text-white/70">
                  <Link href="/docker" className="text-neon-green hover:underline">
                    View containers →
                  </Link>
                </div>
              ) : (
                <p className="text-xs text-white/50">
                  CachePanel could not reach the Docker daemon. Mount <code>/var/run/docker.sock</code> into the container or
                  run CachePanel on the host directly.
                </p>
              )}
            </CardBody>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <div>
              <CardTitle>AI · Ollama</CardTitle>
              <CardSubtitle>
                {ollama?.available
                  ? `${ollama.models.length} models · ${ollama.running.length} loaded${ollama.version ? ' · v' + ollama.version : ''}`
                  : ollama
                    ? 'Offline'
                    : 'checking…'}
              </CardSubtitle>
            </div>
            <Link
              href="/assistant"
              className="rounded-lg border border-neon-magenta/30 bg-neon-magenta/10 p-2 text-neon-magenta transition-colors hover:bg-neon-magenta/20"
              aria-label="Open Assistant"
            >
              <Sparkles className="h-4 w-4" />
            </Link>
          </CardHeader>
          <CardBody>
            {ollama?.available ? (
              <div>
                <div className="text-xs text-white/50">Default model</div>
                <div className="mt-0.5 font-mono text-sm text-white">{ollama.defaultModel}</div>
                {ollama.models.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {ollama.models.slice(0, 8).map((m) => (
                      <span
                        key={m.name}
                        className="rounded-md border border-white/10 bg-white/[0.02] px-2 py-0.5 text-[11px] text-white/70"
                      >
                        {m.name}
                      </span>
                    ))}
                    {ollama.models.length > 8 ? (
                      <span className="text-[11px] text-white/40">+{ollama.models.length - 8} more</span>
                    ) : null}
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-white/50">
                    No models installed yet. Run <code className="text-neon-green">ollama pull mistral</code> on the host.
                  </p>
                )}
                <Link href="/assistant" className="mt-3 inline-block text-xs text-neon-magenta hover:underline">
                  Open assistant →
                </Link>
              </div>
            ) : (
              <p className="text-xs text-white/50">
                Install Ollama on the host (
                <code className="text-neon-magenta">curl -fsSL https://ollama.com/install.sh | sh</code>) and bind it to{' '}
                <code>0.0.0.0:11434</code> so CachePanel can reach it.
              </p>
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Environment</CardTitle>
            <CardSubtitle>Runtime and platform info</CardSubtitle>
          </div>
          {stats.docker ? (
            <Badge tone={stats.docker.available ? 'green' : 'neutral'}>
              Docker {stats.docker.available ? 'available' : 'unavailable'}
            </Badge>
          ) : stats.server ? (
            <Badge tone="neutral">remote · {stats.server.name}</Badge>
          ) : null}
        </CardHeader>
        <CardBody>
          <dl className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
            <div>
              <dt className="text-xs uppercase tracking-wider text-white/40">Hostname</dt>
              <dd className="mt-1 text-white">{stats.os.hostname || '—'}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-white/40">OS</dt>
              <dd className="mt-1 text-white">
                {stats.os.distro || stats.os.platform || '—'} {stats.os.release}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-white/40">Arch</dt>
              <dd className="mt-1 text-white">{stats.os.arch || '—'}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wider text-white/40">Node</dt>
              <dd className="mt-1 text-white">{stats.node.version || '—'}</dd>
            </div>
            {stats.docker?.available ? (
              <>
                <div>
                  <dt className="text-xs uppercase tracking-wider text-white/40">Containers</dt>
                  <dd className="mt-1 text-white">
                    {stats.docker.running} running / {stats.docker.containers} total
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wider text-white/40">Images</dt>
                  <dd className="mt-1 text-white">{stats.docker.images}</dd>
                </div>
              </>
            ) : null}
          </dl>
        </CardBody>
      </Card>

      {stats.server?.isPrimary !== false ? (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Recent logins</CardTitle>
              <CardSubtitle>Last 8 events</CardSubtitle>
            </div>
            <Clock className="h-4 w-4 text-white/30" />
          </CardHeader>
          <CardBody>
            {stats.recentLogins.length === 0 ? (
              <EmptyState title="No logins yet" />
            ) : (
              <ul className="space-y-3">
                {stats.recentLogins.map((l) => (
                  <li key={l.id} className="flex items-center gap-3">
                    <Avatar src={l.user?.avatar ?? null} fallback={l.user?.username ?? '?'} size={28} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-white">{l.user?.username ?? 'unknown'}</div>
                      <div className="text-[11px] text-white/40">{formatRelative(l.createdAt)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Terminal sessions</CardTitle>
              <CardSubtitle>Active and recent</CardSubtitle>
            </div>
            <TerminalSquare className="h-4 w-4 text-white/30" />
          </CardHeader>
          <CardBody>
            {stats.terminalSessions.length === 0 ? (
              <EmptyState title="No sessions" />
            ) : (
              <ul className="space-y-3">
                {stats.terminalSessions.map((s) => (
                  <li key={s.id} className="flex items-center gap-3">
                    <Avatar src={s.user?.avatar ?? null} fallback={s.user?.username ?? '?'} size={28} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-white">{s.user?.username ?? 'unknown'}</div>
                      <div className="text-[11px] text-white/40">{formatRelative(s.startedAt)}</div>
                    </div>
                    <Badge tone={s.status === 'active' ? 'green' : 'neutral'}>{s.status}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>File activity</CardTitle>
              <CardSubtitle>Recent changes</CardSubtitle>
            </div>
            <FileEdit className="h-4 w-4 text-white/30" />
          </CardHeader>
          <CardBody>
            {stats.recentFileActions.length === 0 ? (
              <EmptyState title="No file actions" />
            ) : (
              <ul className="space-y-3">
                {stats.recentFileActions.map((f) => (
                  <li key={f.id} className="flex items-start gap-3">
                    <Avatar src={f.user?.avatar ?? null} fallback={f.user?.username ?? '?'} size={28} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-white" title={f.path}>
                        {f.path}
                      </div>
                      <div className="text-[11px] text-white/40">
                        {f.action} · {formatRelative(f.createdAt)}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
      ) : null}
    </div>
  );
}
