import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorize } from '@/lib/api-auth';
import { runOnHost } from '@/lib/host-probe';
import { audit } from '@/lib/audit';
import { getRequestServerId } from '@/lib/req-server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface VolumeRow {
  name: string;
  driver: string;
  mountpoint: string;
  scope: string;
  inUse: boolean;
  sizeBytes: number | null;
}

export async function GET(req: Request) {
  const auth = await authorize();
  if (!auth.ok) return auth.response;
  const serverId = getRequestServerId(req);
  const opts = { serverId, userId: auth.user.id };

  const ls = await runOnHost(
    "docker volume ls --format '{{.Name}}|{{.Driver}}|{{.Scope}}' 2>/dev/null",
    opts,
  );
  if (ls.code !== 0) {
    return NextResponse.json({ volumes: [], error: ls.stderr.trim() }, { status: 502 });
  }

  // Get in-use set in one go.
  const used = await runOnHost(
    "docker ps -aq | xargs -r docker inspect --format '{{range .Mounts}}{{if eq .Type \"volume\"}}{{.Name}}\\n{{end}}{{end}}' 2>/dev/null | sort -u",
    opts,
  );
  const inUseSet = new Set(used.stdout.split('\n').map((s) => s.trim()).filter(Boolean));

  const volumes: VolumeRow[] = [];
  for (const line of ls.stdout.trim().split('\n')) {
    if (!line) continue;
    const [name, driver, scope] = line.split('|');
    if (!name) continue;
    // Mountpoint lookup is per-volume; one extra round trip per volume is
    // cheap relative to the SSH overhead.
    const mp = await runOnHost(
      `docker volume inspect --format '{{.Mountpoint}}' ${name}`,
      opts,
    );
    const mountpoint = mp.code === 0 ? mp.stdout.trim() : '';
    let sizeBytes: number | null = null;
    if (mountpoint) {
      const du = await runOnHost(
        `du -sb ${mountpoint} 2>/dev/null | awk '{print $1}'`,
        opts,
      );
      const n = parseInt(du.stdout.trim(), 10);
      if (Number.isFinite(n)) sizeBytes = n;
    }
    volumes.push({
      name,
      driver: driver ?? 'local',
      mountpoint,
      scope: scope ?? 'local',
      inUse: inUseSet.has(name),
      sizeBytes,
    });
  }

  return NextResponse.json({ volumes });
}

const cleanSchema = z.object({
  action: z.enum(['prune-images', 'prune-volumes', 'prune-networks', 'prune-builder', 'prune-all', 'remove-volume']),
  volumeName: z.string().optional(),
  // If true, even in-use volumes can go. We default to false because this is
  // a disastrously easy way to lose data.
  force: z.boolean().optional().default(false),
});

export async function POST(req: Request) {
  const auth = await authorize({ requireMfa: true });
  if (!auth.ok) return auth.response;
  if (auth.user.role !== 'OWNER' && auth.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'OWNER or ADMIN required' }, { status: 403 });
  }
  const serverId = getRequestServerId(req);
  const opts = { serverId, userId: auth.user.id, timeoutMs: 5 * 60_000 };

  const raw = await req.json().catch(() => null);
  const parsed = cleanSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });

  let cmd = '';
  switch (parsed.data.action) {
    case 'prune-images':
      cmd = 'docker image prune -af 2>&1';
      break;
    case 'prune-volumes':
      cmd = 'docker volume prune -f 2>&1';
      break;
    case 'prune-networks':
      cmd = 'docker network prune -f 2>&1';
      break;
    case 'prune-builder':
      cmd = 'docker builder prune -af 2>&1';
      break;
    case 'prune-all':
      // -a removes ALL unused images, not just dangling. -f skips confirm.
      cmd = 'docker system prune -af --volumes 2>&1';
      break;
    case 'remove-volume':
      if (!parsed.data.volumeName) {
        return NextResponse.json({ error: 'volumeName required' }, { status: 400 });
      }
      if (!/^[a-zA-Z0-9._-]+$/.test(parsed.data.volumeName)) {
        return NextResponse.json({ error: 'Invalid volume name' }, { status: 400 });
      }
      cmd = `docker volume rm ${parsed.data.force ? '-f ' : ''}${parsed.data.volumeName} 2>&1`;
      break;
  }

  const res = await runOnHost(cmd, opts);
  await audit({
    userId: auth.user.id,
    action: 'settings.changed',
    target: `docker.${parsed.data.action}`,
    metadata: { volumeName: parsed.data.volumeName, success: res.code === 0 },
  });

  return NextResponse.json({
    success: res.code === 0,
    exitCode: res.code,
    output: res.stdout.slice(-50_000),
  });
}
