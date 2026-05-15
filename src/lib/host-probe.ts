// Run a one-shot command on a managed host via SSH. Server-aware: pass a
// Server (and optionally a panel-user id) to target a specific machine. With
// no Server, falls back to the primary record (auto-created from SSH_*).

import { spawn } from 'node:child_process';
import type { Server } from '@prisma/client';
import { getServerById, resolveSshSpec, sshArgs } from './servers';

const CACHE_TTL_MS = 4000;
const cache = new Map<string, { value: unknown; expiresAt: number }>();

function getCached<T>(key: string): T | undefined {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value as T;
  return undefined;
}
function setCached<T>(key: string, value: T) {
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

export function isSshConfigured(): boolean {
  // Kept for backwards compat — we now check the Server table at runtime.
  return !!(process.env.SSH_HOST && process.env.SSH_USER && process.env.SSH_KEY_PATH);
}

interface RunOpts {
  serverId?: string | null;
  userId?: string | null;
  timeoutMs?: number;
}

export async function runOnHost(
  command: string,
  optsOrTimeout: number | RunOpts = 4000,
): Promise<{ stdout: string; stderr: string; code: number }> {
  const opts: RunOpts =
    typeof optsOrTimeout === 'number' ? { timeoutMs: optsOrTimeout } : optsOrTimeout;
  const timeoutMs = opts.timeoutMs ?? 4000;

  const server = await getServerById(opts.serverId);
  if (!server) {
    return { stdout: '', stderr: 'No server configured', code: -1 };
  }
  const spec = await resolveSshSpec(server, opts.userId ?? null);
  const args = sshArgs(spec, []);
  args.push(command);

  return new Promise((resolve) => {
    const child = spawn('ssh', args);
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (b) => (stdout += b.toString()));
    child.stderr.on('data', (b) => (stderr += b.toString()));
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code: code ?? -1 });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ stdout: '', stderr: err.message, code: -1 });
    });
  });
}

export interface HostGpu {
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

export async function getHostGpus(server?: Server | null): Promise<HostGpu[]> {
  const sid = server?.id ?? '__primary__';
  const cached = getCached<HostGpu[]>(`gpus:${sid}`);
  if (cached) return cached;

  const nvidia = await runOnHost(
    'nvidia-smi --query-gpu=name,driver_version,memory.total,memory.used,memory.free,utilization.gpu,utilization.memory,temperature.gpu,power.draw --format=csv,noheader,nounits 2>/dev/null',
    { serverId: server?.id, timeoutMs: 6000 },
  );
  if (nvidia.code === 0 && nvidia.stdout.trim()) {
    const gpus: HostGpu[] = nvidia.stdout
      .trim()
      .split('\n')
      .map((line) => {
        const [name, driver, memTotal, memUsed, memFree, util, memUtil, temp, power] = line
          .split(',')
          .map((s) => s.trim());
        const num = (s: string) => {
          const n = parseFloat(s);
          return Number.isFinite(n) ? n : null;
        };
        return {
          vendor: 'NVIDIA',
          model: name || null,
          driver: driver || null,
          vramMb: num(memTotal ?? ''),
          vramUsedMb: num(memUsed ?? ''),
          vramFreeMb: num(memFree ?? ''),
          loadPct: num(util ?? ''),
          memLoadPct: num(memUtil ?? ''),
          tempC: num(temp ?? ''),
          powerW: num(power ?? ''),
        };
      });
    setCached(`gpus:${sid}`, gpus);
    return gpus;
  }

  const lspci = await runOnHost(
    "lspci -mm -nn | awk -F'\"' '/VGA|3D|Display/ { print $4 \"\\t\" $6 }' 2>/dev/null",
    { serverId: server?.id },
  );
  if (lspci.code === 0 && lspci.stdout.trim()) {
    const gpus: HostGpu[] = lspci.stdout
      .trim()
      .split('\n')
      .map((line) => {
        const [vendor, model] = line.split('\t').map((s) => s.trim());
        return {
          vendor: vendor || null,
          model: model || null,
          driver: null,
          vramMb: null,
          vramUsedMb: null,
          vramFreeMb: null,
          loadPct: null,
          memLoadPct: null,
          tempC: null,
          powerW: null,
        };
      });
    setCached(`gpus:${sid}`, gpus);
    return gpus;
  }

  setCached(`gpus:${sid}`, []);
  return [];
}

export interface HostCpuTemp {
  tempC: number | null;
}

export async function getHostCpuTemp(server?: Server | null): Promise<HostCpuTemp> {
  const sid = server?.id ?? '__primary__';
  const cached = getCached<HostCpuTemp>(`cpuTemp:${sid}`);
  if (cached) return cached;

  const sysProbe = await runOnHost(
    "cat /sys/class/thermal/thermal_zone*/temp 2>/dev/null | sort -nr | head -1",
    { serverId: server?.id },
  );
  if (sysProbe.code === 0 && sysProbe.stdout.trim()) {
    const raw = parseInt(sysProbe.stdout.trim(), 10);
    if (Number.isFinite(raw)) {
      const tempC = raw > 1000 ? raw / 1000 : raw;
      const val = { tempC };
      setCached(`cpuTemp:${sid}`, val);
      return val;
    }
  }
  const empty = { tempC: null };
  setCached(`cpuTemp:${sid}`, empty);
  return empty;
}

// Snapshot of the basics so the dashboard can show stats per server.
export interface HostSnapshot {
  hostname: string;
  uptimeSeconds: number | null;
  kernel: string | null;
  loadAvg: number | null;
  memTotalKb: number | null;
  memAvailableKb: number | null;
  cpuPct: number | null;
  cpuCores: number | null;
  diskTotalBytes: number | null;
  diskUsedBytes: number | null;
  distro: string | null;
  release: string | null;
  arch: string | null;
  nodeVersion: string | null;
}

// Use a unique multi-char delimiter between fields ("|||"). Single-char
// separators (\t, |) get eaten by various shells/awk locales.
const SEP = '|||';

export async function getHostSnapshot(server?: Server | null): Promise<HostSnapshot | null> {
  const sid = server?.id ?? '__primary__';
  const cached = getCached<HostSnapshot>(`snap:${sid}`);
  if (cached) return cached;

  // Single SSH round-trip that emits one line per field.
  const probe = await runOnHost(
    [
      `printf '%s${SEP}\\n' "$(hostname)"`,
      `printf '%s${SEP}\\n' "$(awk '{print int($1)}' /proc/uptime 2>/dev/null)"`,
      `printf '%s${SEP}\\n' "$(uname -r)"`,
      `printf '%s${SEP}\\n' "$(uname -m)"`,
      `printf '%s${SEP}\\n' "$(awk '{print $1}' /proc/loadavg 2>/dev/null)"`,
      `printf '%s${SEP}\\n' "$(awk '/MemTotal/ {print $2}' /proc/meminfo)"`,
      `printf '%s${SEP}\\n' "$(awk '/MemAvailable/ {print $2}' /proc/meminfo)"`,
      `printf '%s${SEP}\\n' "$(nproc 2>/dev/null || echo '')"`,
      // distro from /etc/os-release
      `printf '%s${SEP}\\n' "$(. /etc/os-release 2>/dev/null && echo \"$NAME\")"`,
      `printf '%s${SEP}\\n' "$(. /etc/os-release 2>/dev/null && echo \"$VERSION_ID\")"`,
      // Disk: sum total/used across "real" filesystems. We can't rely on
      // \`df --total\` (GNU-only) or on -x flags (busybox lacks them), so we
      // parse the standard output and skip pseudo filesystems by name.
      `printf '%s${SEP}\\n' "$(df -P -k 2>/dev/null | awk 'NR>1 && $1 !~ /^(tmpfs|devtmpfs|overlay|squashfs|udev|none|proc|sysfs|cgroup|cgroup2|rootfs)$/ && $6 !~ /^\\/(proc|sys|run|dev|snap|var\\/lib\\/docker)/ { t+=$2; u+=$3 } END { print t*1024 }')"`,
      `printf '%s${SEP}\\n' "$(df -P -k 2>/dev/null | awk 'NR>1 && $1 !~ /^(tmpfs|devtmpfs|overlay|squashfs|udev|none|proc|sysfs|cgroup|cgroup2|rootfs)$/ && $6 !~ /^\\/(proc|sys|run|dev|snap|var\\/lib\\/docker)/ { t+=$2; u+=$3 } END { print u*1024 }')"`,
      `printf '%s${SEP}\\n' "$(node -v 2>/dev/null || echo '')"`,
      // Two CPU samples 200ms apart
      `awk '/^cpu / { idle=$5+$6; total=0; for (i=2;i<=NF;i++) total+=$i; print idle " " total }' /proc/stat`,
      `sleep 0.2`,
      `awk '/^cpu / { idle=$5+$6; total=0; for (i=2;i<=NF;i++) total+=$i; print idle " " total }' /proc/stat`,
    ].join(' && '),
    { serverId: server?.id, timeoutMs: 6000 },
  );
  if (probe.code !== 0) return null;

  // Parse the |||-terminated fields, then peel the trailing two CPU lines off.
  const lines = probe.stdout.split('\n').map((l) => l.trim()).filter((l) => l.length);
  // The CPU sample lines don't end with SEP; everything else does.
  const fields = lines
    .filter((l) => l.endsWith(SEP))
    .map((l) => l.slice(0, -SEP.length));
  const cpuLines = lines.filter((l) => !l.endsWith(SEP));

  const [hostname, uptime, kernel, arch, load, mt, ma, cores, distro, release, dTotal, dUsed, nodeV] = fields;

  const cpu1 = (cpuLines[0] ?? '').split(' ').map(Number);
  const cpu2 = (cpuLines[1] ?? '').split(' ').map(Number);
  let cpuPct: number | null = null;
  if (cpu1.length === 2 && cpu2.length === 2) {
    const idleD = cpu2[0]! - cpu1[0]!;
    const totalD = cpu2[1]! - cpu1[1]!;
    if (totalD > 0) cpuPct = Math.max(0, Math.min(100, (1 - idleD / totalD) * 100));
  }
  const num = (s: string | undefined): number | null => {
    if (!s) return null;
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : null;
  };

  const snap: HostSnapshot = {
    hostname: hostname || '',
    uptimeSeconds: num(uptime),
    kernel: kernel || null,
    arch: arch || null,
    loadAvg: num(load),
    memTotalKb: num(mt),
    memAvailableKb: num(ma),
    cpuPct,
    cpuCores: num(cores),
    diskTotalBytes: num(dTotal),
    diskUsedBytes: num(dUsed),
    distro: distro || null,
    release: release || null,
    nodeVersion: nodeV || null,
  };
  setCached(`snap:${sid}`, snap);
  return snap;
}
