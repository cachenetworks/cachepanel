import { NextResponse } from 'next/server';
import { authorize } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const auth = await authorize();
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  // Default to last hour; max 7 days.
  const hours = Math.min(7 * 24, Math.max(1, Number.parseInt(url.searchParams.get('hours') ?? '1', 10) || 1));
  const since = new Date(Date.now() - hours * 60 * 60_000);

  const snapshots = await prisma.serverSnapshot.findMany({
    where: { serverId: params.id, recordedAt: { gte: since } },
    orderBy: { recordedAt: 'asc' },
    select: {
      cpuPct: true,
      memPct: true,
      diskPct: true,
      loadAvg1: true,
      reachable: true,
      recordedAt: true,
    },
    take: 2000,
  });

  return NextResponse.json({ snapshots, hours, since: since.toISOString() });
}
