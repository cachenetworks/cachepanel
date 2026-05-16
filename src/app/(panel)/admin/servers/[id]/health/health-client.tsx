'use client';

import * as React from 'react';
import Link from 'next/link';
import { Activity, ArrowLeft, RefreshCw } from 'lucide-react';
import { Card, CardBody, CardHeader, CardSubtitle, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toaster';

interface Snapshot {
  cpuPct: number | null;
  memPct: number | null;
  diskPct: number | null;
  loadAvg1: number | null;
  reachable: boolean;
  recordedAt: string;
}

interface HistoryResponse {
  snapshots: Snapshot[];
  hours: number;
}

const RANGES: Array<{ label: string; hours: number }> = [
  { label: '1h', hours: 1 },
  { label: '6h', hours: 6 },
  { label: '24h', hours: 24 },
  { label: '7d', hours: 24 * 7 },
];

function Sparkline({
  data,
  height = 60,
  color = '#00f708',
  max,
}: {
  data: Array<{ x: number; y: number | null }>;
  height?: number;
  color?: string;
  max?: number;
}) {
  const validData = data.filter((d) => d.y !== null) as Array<{ x: number; y: number }>;
  if (validData.length < 2) {
    return (
      <div
        className="flex items-center justify-center rounded-md border border-white/5 bg-white/[0.02] text-[10px] text-white/30"
        style={{ height }}
      >
        not enough data yet
      </div>
    );
  }
  const xs = validData.map((d) => d.x);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const ys = validData.map((d) => d.y);
  const minY = 0;
  const maxY = max ?? Math.max(1, ...ys);
  const width = 600;
  const innerH = height - 8;
  const points = validData
    .map((d) => {
      const x = ((d.x - minX) / Math.max(1, maxX - minX)) * width;
      const y = innerH - ((d.y - minY) / Math.max(0.001, maxY - minY)) * innerH + 4;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const areaPoints = `0,${height} ${points} ${width},${height}`;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="block h-full w-full"
      style={{ height }}
    >
      <polygon points={areaPoints} fill={color} fillOpacity={0.08} />
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function HealthClient({
  server,
}: {
  server: { id: string; name: string; hostname: string; isPrimary: boolean };
}) {
  const { toast } = useToast();
  const [data, setData] = React.useState<HistoryResponse | null>(null);
  const [hours, setHours] = React.useState(1);
  const [refreshKey, setRefreshKey] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/servers/${server.id}/history?hours=${hours}`, { cache: 'no-store' });
        if (!res.ok) throw new Error(await res.text());
        if (!cancelled) setData(await res.json());
      } catch (err) {
        if (!cancelled) toast({ variant: 'error', title: 'History load failed', description: err instanceof Error ? err.message : String(err) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [server.id, hours, refreshKey, toast]);

  const latest = data?.snapshots[data.snapshots.length - 1];
  const reachablePct = data
    ? Math.round((data.snapshots.filter((s) => s.reachable).length / Math.max(1, data.snapshots.length)) * 100)
    : null;

  const buildSeries = (key: 'cpuPct' | 'memPct' | 'diskPct' | 'loadAvg1') =>
    (data?.snapshots ?? []).map((s) => ({
      x: new Date(s.recordedAt).getTime(),
      y: s[key],
    }));

  return (
    <div className="space-y-5">
      <div>
        <Link href="/admin/servers" className="inline-flex items-center gap-1 text-xs text-white/50 hover:text-white">
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to servers
        </Link>
        <div className="mt-2 flex items-end justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-white">
              <Activity className="h-5 w-5 text-neon-green" />
              {server.name}
              {server.isPrimary ? <Badge tone="magenta">primary</Badge> : null}
            </h1>
            <p className="text-xs text-white/50">{server.hostname}</p>
          </div>
          <div className="flex items-center gap-1">
            {RANGES.map((r) => (
              <button
                key={r.hours}
                onClick={() => setHours(r.hours)}
                className={`rounded-md border px-2 py-1 text-[11px] transition-colors ${
                  hours === r.hours
                    ? 'border-neon-green/50 bg-neon-green/10 text-neon-green'
                    : 'border-white/10 text-white/50 hover:border-white/25 hover:text-white'
                }`}
              >
                {r.label}
              </button>
            ))}
            <Button variant="outline" size="sm" onClick={() => setRefreshKey((k) => k + 1)}>
              <RefreshCw className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </div>

      {!data ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : data.snapshots.length === 0 ? (
        <Card>
          <CardBody>
            <p className="py-6 text-center text-sm text-white/50">
              No snapshots yet. The poller writes one per minute — come back in a minute.
            </p>
          </CardBody>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryCard label="Uptime" value={reachablePct === null ? '—' : `${reachablePct}%`} tone={reachablePct && reachablePct > 95 ? 'green' : 'yellow'} />
            <SummaryCard label="Last CPU/load" value={latest?.loadAvg1 != null ? latest.loadAvg1.toFixed(2) : '—'} />
            <SummaryCard label="Last memory" value={latest?.memPct != null ? `${latest.memPct.toFixed(1)}%` : '—'} />
            <SummaryCard label="Last disk" value={latest?.diskPct != null ? `${latest.diskPct.toFixed(0)}%` : '—'} tone={latest?.diskPct && latest.diskPct >= 90 ? 'red' : undefined} />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <ChartCard title="Memory %" tone="#b388ff" data={buildSeries('memPct')} max={100} />
            <ChartCard title="Disk %" tone="#00f708" data={buildSeries('diskPct')} max={100} />
            <ChartCard title="Load average (1m)" tone="#ffd166" data={buildSeries('loadAvg1')} />
            <ChartCard title="Reachability" tone="#e600ff" data={(data?.snapshots ?? []).map((s) => ({ x: new Date(s.recordedAt).getTime(), y: s.reachable ? 1 : 0 }))} max={1} />
          </div>
        </>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'green' | 'yellow' | 'red';
}) {
  const color =
    tone === 'red'
      ? 'text-red-300'
      : tone === 'yellow'
        ? 'text-yellow-300'
        : tone === 'green'
          ? 'text-neon-green'
          : 'text-white';
  return (
    <Card>
      <CardBody>
        <div className="text-[10px] uppercase tracking-wider text-white/40">{label}</div>
        <div className={`mt-1 text-xl font-semibold ${color}`}>{value}</div>
      </CardBody>
    </Card>
  );
}

function ChartCard({
  title,
  tone,
  data,
  max,
}: {
  title: string;
  tone: string;
  data: Array<{ x: number; y: number | null }>;
  max?: number;
}) {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{title}</CardTitle>
          <CardSubtitle>{data.length} samples</CardSubtitle>
        </div>
      </CardHeader>
      <CardBody>
        <Sparkline data={data} color={tone} height={80} max={max} />
      </CardBody>
    </Card>
  );
}
