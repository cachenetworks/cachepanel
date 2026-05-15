import { NextResponse } from 'next/server';
import { authorize } from '@/lib/api-auth';
import { getContainerStats, getDockerInfo, listContainers } from '@/lib/docker-api';
import { getRemoteContainerStats, getRemoteDockerInfo, listRemoteContainers } from '@/lib/docker-remote';
import { getRequestServerId } from '@/lib/req-server';
import { getServerById } from '@/lib/servers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const auth = await authorize();
  if (!auth.ok) return auth.response;

  const serverId = getRequestServerId(req);
  const server = await getServerById(serverId);
  const isPrimary = !!server?.isPrimary;

  // Local socket on primary, SSH on remote.
  if (isPrimary || !server) {
    const [info, containers] = await Promise.all([getDockerInfo(), listContainers()]);
    const running = containers.filter((c) => c.state === 'running');
    const statsList = await Promise.all(running.map((c) => getContainerStats(c.id)));
    const statsById = new Map(running.map((c, i) => [c.id, statsList[i]]));
    const enriched = containers.map((c) => {
      const s = statsById.get(c.id);
      return {
        ...c,
        cpuPct: s?.cpuPct ?? 0,
        memUsed: s?.memUsed ?? 0,
        memLimit: s?.memLimit ?? 0,
      };
    });
    enriched.sort((a, b) => {
      if (a.state !== b.state) return a.state === 'running' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return NextResponse.json({
      info,
      containers: enriched,
      dockerAvailable: info.available,
      via: 'socket',
    });
  }

  // Remote server: shell out to docker over SSH.
  const opts = { server, userId: auth.user.id };
  const [info, containers, statsMap] = await Promise.all([
    getRemoteDockerInfo(opts),
    listRemoteContainers(opts),
    getRemoteContainerStats(opts).catch(() => new Map()),
  ]);
  const enriched = containers.map((c) => {
    const s = statsMap.get(c.id);
    return {
      ...c,
      cpuPct: s?.cpuPct ?? 0,
      memUsed: s?.memUsed ?? 0,
      memLimit: s?.memLimit ?? 0,
    };
  });
  enriched.sort((a, b) => {
    if (a.state !== b.state) return a.state === 'running' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return NextResponse.json({
    info,
    containers: enriched,
    dockerAvailable: info.available,
    via: 'ssh',
  });
}
