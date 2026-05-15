import { NextResponse } from 'next/server';
import os from 'node:os';
import { authorize } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { getDockerInfo } from '@/lib/docker-api';
import { getRemoteDockerInfo } from '@/lib/docker-remote';
import { getHostCpuTemp, getHostGpus, getHostSnapshot, isSshConfigured } from '@/lib/host-probe';
import { getRequestServerId } from '@/lib/req-server';
import { getServerById } from '@/lib/servers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function loadSystemInfo() {
  const si = await import('systeminformation');
  const [cpuLoad, mem, fs, osInfo, cpuTemp] = await Promise.all([
    si.currentLoad(),
    si.mem(),
    si.fsSize().catch(() => []),
    si.osInfo(),
    si.cpuTemperature().catch(() => ({ main: null, cores: [] as number[] })),
  ]);
  return { cpuLoad, mem, fs, osInfo, cpuTemp };
}

export async function GET(req: Request) {
  const auth = await authorize();
  if (!auth.ok) return auth.response;

  // Resolve which server to ask. With no ?server=, defaults to primary.
  const serverId = getRequestServerId(req);
  const server = await getServerById(serverId);
  const isPrimary = !!server?.isPrimary;

  try {
    const [sys, dockerInfo, hostGpus, hostTemp, snapshot] = await Promise.all([
      loadSystemInfo(),
      // Docker on the primary uses the local socket; on remote servers we
      // shell out to `docker info` over SSH.
      isPrimary
        ? getDockerInfo()
        : server
          ? getRemoteDockerInfo({ server, userId: auth.user.id })
          : Promise.resolve(null),
      getHostGpus(server),
      getHostCpuTemp(server),
      isPrimary ? Promise.resolve(null) : getHostSnapshot(server),
    ]);
    const totalDisk = sys.fs.reduce((acc, d) => acc + (d.size || 0), 0);
    const usedDisk = sys.fs.reduce((acc, d) => acc + (d.used || 0), 0);

    const [recentLogins, terminalSessions, recentFileActions] = await Promise.all([
      prisma.auditLog.findMany({
        where: { action: 'login.success' },
        orderBy: { createdAt: 'desc' },
        take: 8,
        include: { user: { select: { username: true, avatar: true, discordId: true } } },
      }),
      prisma.terminalSession.findMany({
        orderBy: { startedAt: 'desc' },
        take: 8,
        include: { user: { select: { username: true, avatar: true } } },
      }),
      prisma.fileAction.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: { user: { select: { username: true, avatar: true } } },
      }),
    ]);

    // Host's CPU temp (read via SSH) is much more reliable than the
    // container's view of /sys, which usually returns nothing.
    const cpuTempC =
      hostTemp.tempC ?? (typeof sys.cpuTemp?.main === 'number' ? sys.cpuTemp.main : null);

    // For non-primary servers we use the remote snapshot (CPU%, mem, uptime,
    // hostname, disk, distro, …). The primary uses the container's own /proc readings.
    const cpu = isPrimary
      ? { load: Math.max(0, Math.min(100, sys.cpuLoad.currentLoad)), cores: os.cpus().length, tempC: cpuTempC }
      : { load: snapshot?.cpuPct ?? 0, cores: snapshot?.cpuCores ?? 0, tempC: cpuTempC };
    const mem = isPrimary
      ? { total: sys.mem.total, used: sys.mem.active, free: sys.mem.available }
      : {
          total: (snapshot?.memTotalKb ?? 0) * 1024,
          used: ((snapshot?.memTotalKb ?? 0) - (snapshot?.memAvailableKb ?? 0)) * 1024,
          free: (snapshot?.memAvailableKb ?? 0) * 1024,
        };
    const uptime = isPrimary ? os.uptime() : snapshot?.uptimeSeconds ?? 0;
    const disk = isPrimary
      ? { total: totalDisk, used: usedDisk, free: Math.max(0, totalDisk - usedDisk) }
      : {
          total: snapshot?.diskTotalBytes ?? 0,
          used: snapshot?.diskUsedBytes ?? 0,
          free: Math.max(0, (snapshot?.diskTotalBytes ?? 0) - (snapshot?.diskUsedBytes ?? 0)),
        };
    const osBlock = isPrimary
      ? {
          platform: sys.osInfo.platform,
          distro: sys.osInfo.distro,
          release: sys.osInfo.release,
          kernel: sys.osInfo.kernel,
          arch: sys.osInfo.arch,
          hostname: sys.osInfo.hostname,
        }
      : {
          platform: 'linux',
          distro: snapshot?.distro ?? '',
          release: snapshot?.release ?? '',
          kernel: snapshot?.kernel ?? '',
          arch: snapshot?.arch ?? '',
          hostname: snapshot?.hostname ?? server?.name ?? '',
        };

    return NextResponse.json({
      server: server ? { id: server.id, name: server.name, hostname: server.hostname, isPrimary: server.isPrimary } : null,
      cpu,
      mem,
      disk,
      uptime,
      os: osBlock,
      node: { version: isPrimary ? process.version : snapshot?.nodeVersion ?? '' },
      gpus: hostGpus,
      gpuSource: isSshConfigured() ? 'host-ssh' : 'unavailable',
      docker: dockerInfo
        ? {
            available: dockerInfo.available,
            containers: dockerInfo.containers,
            running: dockerInfo.running,
            images: dockerInfo.images,
            serverVersion: dockerInfo.serverVersion ?? null,
            error: dockerInfo.error ?? null,
          }
        : null,
      recentLogins: isPrimary ? recentLogins : [],
      terminalSessions: isPrimary ? terminalSessions : [],
      recentFileActions: isPrimary ? recentFileActions : [],
    });
  } catch (err) {
    console.error('[stats] failed', err);
    return NextResponse.json({ error: 'Failed to load stats' }, { status: 500 });
  }
}
