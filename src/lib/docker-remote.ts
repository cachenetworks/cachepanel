// Talk to docker on a remote host via SSH. Used for non-primary servers
// where we can't reach the daemon socket directly.
//
// Strategy: shell out to `docker` over SSH and parse the structured outputs:
//   - `docker version --format json`
//   - `docker info --format json`
//   - `docker ps --all --format '{{json .}}'`  (one JSON object per line)
//   - `docker stats --no-stream --format '{{json .}}'`
//
// Caching:
//   - container list: 3s (cheap, often re-fetched by the auto-refresh)
//   - info: 10s
// Stats are intentionally not cached — they're the live numbers.

import type { Server } from '@prisma/client';
import { runOnHost } from './host-probe';
import type { DockerContainer, DockerInfo, DockerStats } from './docker-api';

const cache = new Map<string, { value: unknown; expiresAt: number }>();
function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return Promise.resolve(hit.value as T);
  return fn().then((v) => {
    cache.set(key, { value: v, expiresAt: Date.now() + ttlMs });
    return v;
  });
}

interface RemoteRunOpts {
  server: Server;
  userId: string | null;
  timeoutMs?: number;
}

async function runDocker(args: string, opts: RemoteRunOpts) {
  // OpenSSH on Windows defaults to cmd.exe, which interprets single quotes
  // literally. `docker --format '{{json .}}'` works on bash but cmd passes
  // the literal string including the quotes to docker, which then misparses
  // the template. Swap single quotes for double quotes on Windows servers —
  // docker on Windows accepts both, and cmd handles double-quote escaping
  // the way you'd expect. Linux stays untouched.
  let cmd = `docker ${args}`;
  if ((opts.server.os ?? 'linux') === 'windows') {
    cmd = cmd.replace(/'/g, '"');
  }
  return runOnHost(cmd, {
    serverId: opts.server.id,
    userId: opts.userId,
    timeoutMs: opts.timeoutMs ?? 8000,
  });
}

export async function getRemoteDockerInfo(opts: RemoteRunOpts): Promise<DockerInfo> {
  return cached(`info:${opts.server.id}`, 10_000, async () => {
    // Two-call: `docker info` returns container/image counts; `docker version` gives us serverVersion.
    const [info, version] = await Promise.all([
      runDocker('info --format "{{json .}}"', opts),
      runDocker('version --format "{{json .}}"', opts),
    ]);

    if (info.code !== 0) {
      // Common case: no docker installed on the remote
      const stderr = info.stderr || `docker info exited ${info.code}`;
      return {
        available: false,
        containers: 0,
        running: 0,
        paused: 0,
        stopped: 0,
        images: 0,
        error: stderr.includes('command not found')
          ? 'Docker is not installed on this server.'
          : stderr.includes('permission denied')
            ? `User does not have permission to talk to the docker daemon. Add the SSH user to the 'docker' group on the remote box.`
            : stderr.trim().slice(0, 300),
      };
    }

    let infoJson: Record<string, unknown> = {};
    try {
      infoJson = JSON.parse(info.stdout.trim());
    } catch {
      return {
        available: false,
        containers: 0,
        running: 0,
        paused: 0,
        stopped: 0,
        images: 0,
        error: 'Could not parse docker info output.',
      };
    }

    let serverVersion: string | undefined;
    if (version.code === 0) {
      try {
        const v = JSON.parse(version.stdout.trim()) as { Server?: { Version?: string } };
        serverVersion = v.Server?.Version;
      } catch {
        /* ignore — version is optional */
      }
    }

    return {
      available: true,
      containers: (infoJson.Containers as number) ?? 0,
      running: (infoJson.ContainersRunning as number) ?? 0,
      paused: (infoJson.ContainersPaused as number) ?? 0,
      stopped: (infoJson.ContainersStopped as number) ?? 0,
      images: (infoJson.Images as number) ?? 0,
      serverVersion,
    };
  });
}

interface CliContainer {
  ID: string;
  Names: string;
  Image: string;
  State: string;
  Status: string;
  CreatedAt: string;
  Ports: string;
}

function parsePortsString(s: string): Array<{ private: number; public: number | null; type: string; ip: string | null }> {
  // `docker ps` ports format: "0.0.0.0:8080->80/tcp, :::8080->80/tcp, 443/tcp"
  if (!s) return [];
  const out: Array<{ private: number; public: number | null; type: string; ip: string | null }> = [];
  for (const part of s.split(',').map((p) => p.trim()).filter(Boolean)) {
    const m = part.match(/^(?:([\w.:]+):)?(\d+)?->?(\d+)\/(\w+)$/);
    if (!m) {
      // Unmapped port like "443/tcp"
      const simple = part.match(/^(\d+)\/(\w+)$/);
      if (simple) {
        out.push({ private: parseInt(simple[1]!, 10), public: null, type: simple[2]!, ip: null });
      }
      continue;
    }
    const ip = m[1] ?? null;
    const pub = m[2] ? parseInt(m[2], 10) : null;
    const priv = parseInt(m[3]!, 10);
    const proto = m[4]!;
    out.push({ private: priv, public: pub, type: proto, ip: ip && ip !== '0.0.0.0' && ip !== '::' ? ip : null });
  }
  return out;
}

export async function listRemoteContainers(opts: RemoteRunOpts): Promise<DockerContainer[]> {
  return cached(`containers:${opts.server.id}`, 3000, async () => {
    const r = await runDocker(`ps --all --no-trunc --format '{{json .}}'`, opts);
    if (r.code !== 0 || !r.stdout.trim()) return [];
    const out: DockerContainer[] = [];
    for (const line of r.stdout.split('\n').map((l) => l.trim()).filter(Boolean)) {
      try {
        const c = JSON.parse(line) as CliContainer;
        out.push({
          id: c.ID.slice(0, 12),
          name: c.Names.split(',')[0] ?? '',
          image: c.Image,
          state: c.State,
          status: c.Status,
          createdAt: parseDockerDate(c.CreatedAt),
          ports: parsePortsString(c.Ports),
          // `docker ps --format` doesn't surface mounts; remote-host volume
          // browsing would need `docker inspect <id>` per container. Not
          // worth the round-trip cost right now — leave empty so the
          // file-manager "container volumes" section only populates from
          // the local daemon (where we have the unix-socket API and get
          // mounts for free in containers/json).
          mounts: [],
        });
      } catch {
        /* skip malformed line */
      }
    }
    return out;
  });
}

function parseDockerDate(s: string): string {
  // Docker emits dates like "2024-05-15 12:34:56 +0000 UTC". JS chokes on the
  // trailing "UTC" suffix — strip it. Falls back to "now" if unparseable.
  const cleaned = s.replace(/\s+UTC$/i, '').replace(/\s/g, 'T').replace('T', ' ');
  // After replacements: "2024-05-15 12:34:56 +0000"
  const d = new Date(cleaned);
  if (Number.isFinite(d.getTime())) return d.toISOString();
  return new Date().toISOString();
}

interface CliStats {
  ID: string;
  CPUPerc: string;
  MemPerc: string;
  MemUsage: string;
}

function parseSize(s: string): number {
  // "120.4MiB" → bytes
  const m = s.match(/([\d.]+)\s*([KMGTP]?i?B)/i);
  if (!m) return 0;
  const n = parseFloat(m[1]!);
  const unit = m[2]!.toUpperCase();
  const mult: Record<string, number> = {
    B: 1,
    KB: 1000, KIB: 1024,
    MB: 1_000_000, MIB: 1024 * 1024,
    GB: 1_000_000_000, GIB: 1024 ** 3,
    TB: 1_000_000_000_000, TIB: 1024 ** 4,
    PB: 1_000_000_000_000_000, PIB: 1024 ** 5,
  };
  return n * (mult[unit] ?? 1);
}

export async function getRemoteContainerStats(opts: RemoteRunOpts): Promise<Map<string, DockerStats>> {
  // Single batch call — much cheaper than per-container.
  const r = await runDocker(`stats --no-stream --format '{{json .}}'`, { ...opts, timeoutMs: 12_000 });
  const out = new Map<string, DockerStats>();
  if (r.code !== 0) return out;
  for (const line of r.stdout.split('\n').map((l) => l.trim()).filter(Boolean)) {
    try {
      const s = JSON.parse(line) as CliStats;
      const cpu = parseFloat(s.CPUPerc.replace('%', ''));
      // MemUsage is "121.4MiB / 7.71GiB"
      const [usedStr, limitStr] = s.MemUsage.split('/').map((x) => x.trim());
      out.set(s.ID.slice(0, 12), {
        cpuPct: Number.isFinite(cpu) ? cpu : 0,
        memUsed: parseSize(usedStr ?? ''),
        memLimit: parseSize(limitStr ?? ''),
      });
    } catch {
      /* skip */
    }
  }
  return out;
}

// Action verbs (start/stop/restart/pause/unpause/kill/rm/logs).
export async function remoteContainerAction(
  opts: RemoteRunOpts,
  id: string,
  action: 'start' | 'stop' | 'restart' | 'pause' | 'unpause' | 'kill' | 'remove',
  force = false,
): Promise<void> {
  const verb = action === 'remove' ? `rm${force ? ' -f' : ''}` : action;
  const r = await runDocker(`${verb} ${shellQuoteId(id)}`, { ...opts, timeoutMs: 30_000 });
  if (r.code !== 0) {
    throw new Error(r.stderr.trim() || `docker ${verb} exited ${r.code}`);
  }
}

export async function getRemoteContainerLogs(
  opts: RemoteRunOpts,
  id: string,
  tail = 500,
): Promise<string> {
  const r = await runDocker(`logs --tail ${tail} ${shellQuoteId(id)} 2>&1`, {
    ...opts,
    timeoutMs: 15_000,
  });
  if (r.code !== 0 && !r.stdout) {
    throw new Error(r.stderr.trim() || `docker logs exited ${r.code}`);
  }
  return r.stdout;
}

function shellQuoteId(id: string): string {
  // IDs are alnum, but be defensive.
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('Invalid container id');
  return id;
}
