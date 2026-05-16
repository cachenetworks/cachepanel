import { prisma } from './prisma';
import { runOnHost } from './host-probe';
import { emitAlert } from './alerts';

// All state lives in module scope. Single-process panel; if the process restarts
// we lose debouncing state and may re-fire each alert once — acceptable.
const lastDiskAlertPct = new Map<string, number>(); // serverId -> pct we last alerted at
const knownExited = new Map<string, Set<string>>(); // serverId -> container IDs we've seen exited
const unreachableTicks = new Map<string, number>(); // serverId -> consecutive failure count
const unreachableNotified = new Set<string>();

const DISK_THRESHOLD = 90;
const UNREACHABLE_TICKS = 5; // ~5 minutes at 60s interval

interface ServerLite {
  id: string;
  name: string;
}

async function listServers(): Promise<ServerLite[]> {
  try {
    return await prisma.server.findMany({ select: { id: true, name: true } });
  } catch (err) {
    console.error('[alert-pollers] failed to list servers', err);
    return [];
  }
}

async function pollDisk(server: ServerLite) {
  const res = await runOnHost("df -P / 2>/dev/null | awk 'NR==2{print $5}' | tr -d '%'", {
    serverId: server.id,
    timeoutMs: 8000,
  });
  if (res.code !== 0) return;
  const pct = parseInt(res.stdout.trim(), 10);
  if (!Number.isFinite(pct)) return;

  const last = lastDiskAlertPct.get(server.id) ?? 0;
  if (pct >= DISK_THRESHOLD && last < DISK_THRESHOLD) {
    void emitAlert('disk.high', {
      description: `Root filesystem on **${server.name}** is at **${pct}%** usage.`,
      serverName: server.name,
      fields: [{ name: 'Usage', value: `${pct}%`, inline: true }],
    });
    lastDiskAlertPct.set(server.id, pct);
  } else if (pct < DISK_THRESHOLD - 5 && last >= DISK_THRESHOLD) {
    // Reset hysteresis: only clear once we've dropped 5pp below threshold.
    lastDiskAlertPct.set(server.id, pct);
  } else {
    lastDiskAlertPct.set(server.id, pct);
  }
}

async function pollContainers(server: ServerLite) {
  const res = await runOnHost(
    "docker ps -a --filter status=exited --format '{{.ID}}|{{.Names}}|{{.Image}}' 2>/dev/null",
    { serverId: server.id, timeoutMs: 10000 },
  );
  if (res.code !== 0) return;

  const seen = knownExited.get(server.id) ?? new Set<string>();
  const current = new Set<string>();
  const newExits: Array<{ id: string; name: string; image: string }> = [];

  for (const line of res.stdout.trim().split('\n')) {
    if (!line) continue;
    const [id, name, image] = line.split('|');
    if (!id) continue;
    current.add(id);
    if (!seen.has(id)) newExits.push({ id, name: name ?? id.slice(0, 12), image: image ?? '' });
  }

  // First poll just seeds the set — don't fire alerts for containers that were
  // already exited before we started watching.
  if (seen.size === 0 && knownExited.has(server.id) === false) {
    knownExited.set(server.id, current);
    return;
  }

  for (const exit of newExits) {
    // Get the actual exit code — we only alert on non-zero (graceful stops are fine).
    const inspect = await runOnHost(
      `docker inspect --format '{{.State.ExitCode}}' ${exit.id} 2>/dev/null`,
      { serverId: server.id, timeoutMs: 5000 },
    );
    const code = parseInt(inspect.stdout.trim(), 10);
    if (Number.isFinite(code) && code !== 0) {
      void emitAlert('container.died', {
        description: `Container **${exit.name}** on **${server.name}** exited with code **${code}**.`,
        serverName: server.name,
        fields: [
          { name: 'Image', value: exit.image || 'unknown', inline: true },
          { name: 'Exit code', value: String(code), inline: true },
        ],
      });
    }
  }

  knownExited.set(server.id, current);
}

async function pollReachable(server: ServerLite) {
  const res = await runOnHost('echo ok', { serverId: server.id, timeoutMs: 8000 });
  const ticks = unreachableTicks.get(server.id) ?? 0;
  const wasNotified = unreachableNotified.has(server.id);

  if (res.code !== 0 || !res.stdout.includes('ok')) {
    const next = ticks + 1;
    unreachableTicks.set(server.id, next);
    if (next >= UNREACHABLE_TICKS && !wasNotified) {
      void emitAlert('server.unreachable', {
        description: `**${server.name}** hasn't responded to SSH for ${next} consecutive checks.`,
        serverName: server.name,
      });
      unreachableNotified.add(server.id);
    }
  } else {
    if (wasNotified) {
      void emitAlert('server.recovered', {
        description: `**${server.name}** is responding again.`,
        serverName: server.name,
      });
      unreachableNotified.delete(server.id);
    }
    unreachableTicks.set(server.id, 0);
  }
}

let running = false;

export async function runAlertPollers() {
  if (running) {
    console.warn('[alert-pollers] previous tick still running, skipping');
    return;
  }
  running = true;
  try {
    const servers = await listServers();
    // Run each server's checks in sequence to keep SSH load bounded, but
    // parallelize across servers.
    await Promise.all(
      servers.map(async (server) => {
        try {
          await pollReachable(server);
          // Skip the rest if we already know it's down — they'd all time out.
          if ((unreachableTicks.get(server.id) ?? 0) > 0) return;
          await pollDisk(server);
          await pollContainers(server);
        } catch (err) {
          console.error(`[alert-pollers] server ${server.name} tick failed`, err);
        }
      }),
    );
  } finally {
    running = false;
  }
}
