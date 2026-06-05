// Linux remote-host adapter. Wraps the historical POSIX shell commands
// previously inlined in host-fs.ts / host-probe.ts / scheduled-jobs.ts.
// Behaviour is byte-for-byte the same as v1.7.x for existing installs.

import path from 'node:path';
import type { Server } from '@prisma/client';
import { runOnHost, runOnHostStdin } from '../host-probe';
import type {
  AdapterCallOpts,
  HostEntry,
  HostGpu,
  HostSnapshot,
  HostStat,
  RemoteHostAdapter,
  RunResult,
} from '../host-adapter';

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function withServer(serverId: string, opts?: AdapterCallOpts) {
  return { serverId, userId: opts?.userId ?? null, timeoutMs: opts?.timeoutMs };
}

export function makeLinuxAdapter(server: Server): RemoteHostAdapter {
  const sid = server.id;
  return {
    os: 'linux',

    // ---------------- Filesystem ----------------

    async listDir(absPath, opts) {
      const cmd =
        `cd ${shellQuote(absPath)} 2>/dev/null && ` +
        `LC_ALL=C find . -mindepth 1 -maxdepth 1 -printf '%y|||%s|||%T@|||%f\\0' 2>/dev/null`;
      const r = await runOnHost(cmd, { ...withServer(sid, opts), timeoutMs: opts?.timeoutMs ?? 8000 });
      if (r.code !== 0 && !r.stdout) return null;
      const out: HostEntry[] = [];
      for (const rec of r.stdout.split('\0')) {
        if (!rec) continue;
        const [kind, sizeStr, mtimeStr, name] = rec.split('|||');
        if (!name) continue;
        let type: HostEntry['type'] = 'file';
        if (kind === 'd') type = 'directory';
        else if (kind === 'l') type = 'symlink';
        const mtime = parseFloat(mtimeStr ?? '');
        out.push({
          name,
          type,
          size: parseInt(sizeStr ?? '0', 10) || 0,
          modifiedAt: Number.isFinite(mtime) ? new Date(mtime * 1000).toISOString() : null,
        });
      }
      return out;
    },

    async stat(absPath, opts) {
      const r = await runOnHost(
        `stat -c '%F|||%s|||%Y' ${shellQuote(absPath)} 2>/dev/null`,
        withServer(sid, opts),
      );
      if (r.code !== 0 || !r.stdout.trim()) return null;
      const [kind, sizeStr, mtimeStr] = r.stdout.trim().split('|||');
      const type: HostStat['type'] =
        kind === 'directory' ? 'directory' : kind === 'symbolic link' ? 'symlink' : 'file';
      const mtime = parseInt(mtimeStr ?? '', 10);
      return {
        type,
        size: parseInt(sizeStr ?? '0', 10) || 0,
        modifiedAt: Number.isFinite(mtime) ? new Date(mtime * 1000).toISOString() : null,
      };
    },

    async readBytes(absPath, maxBytes, opts) {
      const r = await runOnHost(
        `head -c ${maxBytes + 1} ${shellQuote(absPath)} 2>/dev/null | base64 -w0`,
        { ...withServer(sid, opts), timeoutMs: 60_000 },
      );
      if (r.code !== 0) return null;
      const buf = Buffer.from(r.stdout.trim(), 'base64');
      if (buf.length > maxBytes) return null;
      return buf;
    },

    async readText(absPath, maxBytes, opts) {
      const r = await runOnHost(
        `head -c ${maxBytes + 1} ${shellQuote(absPath)} 2>/dev/null | base64 -w0`,
        { ...withServer(sid, opts), timeoutMs: 10_000 },
      );
      if (r.code !== 0) return null;
      const buf = Buffer.from(r.stdout.trim(), 'base64');
      if (buf.length > maxBytes) return null;
      return buf.toString('utf-8');
    },

    async writeBytes(absPath, buf, opts) {
      const b64 = buf.toString('base64');
      const cmd = `mkdir -p ${shellQuote(path.dirname(absPath))} && base64 -d > ${shellQuote(absPath)}`;
      const r = await runOnHostStdin(cmd, b64, withServer(sid, opts));
      return r.code === 0;
    },

    async writeText(absPath, content, opts) {
      const b64 = Buffer.from(content, 'utf-8').toString('base64');
      const cmd = `mkdir -p ${shellQuote(path.dirname(absPath))} && base64 -d > ${shellQuote(absPath)}`;
      const r = await runOnHostStdin(cmd, b64, withServer(sid, opts));
      return r.code === 0;
    },

    async mkdir(absPath, recursive, opts) {
      const flag = recursive ? '-p ' : '';
      const r = await runOnHost(`mkdir ${flag}${shellQuote(absPath)}`, withServer(sid, opts));
      return r.code === 0;
    },

    async createFile(absPath, opts) {
      const cmd = `mkdir -p ${shellQuote(path.dirname(absPath))} && touch ${shellQuote(absPath)}`;
      const r = await runOnHost(cmd, withServer(sid, opts));
      return r.code === 0;
    },

    async remove(absPath, recursive, opts) {
      const cmd = recursive ? `rm -rf ${shellQuote(absPath)}` : `rm -f ${shellQuote(absPath)}`;
      const r = await runOnHost(cmd, { ...withServer(sid, opts), timeoutMs: 15_000 });
      return r.code === 0;
    },

    async move(from, to, opts) {
      const r = await runOnHost(`mv ${shellQuote(from)} ${shellQuote(to)}`, {
        ...withServer(sid, opts),
        timeoutMs: 8_000,
      });
      return r.code === 0;
    },

    // ---------------- Scheduled jobs (crontab) ----------------

    async listScheduledJobs(opts) {
      const r = await runOnHost('crontab -l 2>/dev/null || true', withServer(sid, opts));
      return r.stdout;
    },

    async writeScheduledJobs(content, opts) {
      const b64 = Buffer.from(content, 'utf-8').toString('base64');
      const r = await runOnHostStdin('base64 -d | crontab -', b64, withServer(sid, opts));
      return r.code === 0;
    },

    // ---------------- User provisioning ----------------

    async userExists(username, opts) {
      const r = await runOnHost(`getent passwd ${shellQuote(username)} >/dev/null`, withServer(sid, opts));
      return r.code === 0;
    },

    async addUser(username, opts) {
      // -m create home, -s default shell. Idempotent isn't strictly needed
      // because callers check userExists first, but useradd returns 9 if
      // the user already exists which we treat as success.
      const cmd =
        `sudo useradd -m -s /bin/bash ${shellQuote(username)} 2>&1 ` +
        `|| ([ $? -eq 9 ] && echo 'already exists')`;
      return runOnHost(cmd, withServer(sid, opts));
    },

    async appendAuthorizedKey(username, publicKey, opts) {
      // Quote with single-quotes; the public-key string never contains apostrophes
      // but escape anyway to be paranoid.
      const safeKey = publicKey.replace(/'/g, `'\\''`);
      const cmd = [
        `sudo -u ${shellQuote(username)} mkdir -p ~${username}/.ssh`,
        `sudo -u ${shellQuote(username)} chmod 700 ~${username}/.ssh`,
        `sudo -u ${shellQuote(username)} touch ~${username}/.ssh/authorized_keys`,
        `sudo -u ${shellQuote(username)} chmod 600 ~${username}/.ssh/authorized_keys`,
        `echo '${safeKey}' | sudo -u ${shellQuote(username)} tee -a ~${username}/.ssh/authorized_keys >/dev/null`,
      ].join(' && ');
      return runOnHost(cmd, withServer(sid, opts));
    },

    // ---------------- System probe ----------------

    async snapshot(opts) {
      // Single round-trip: print key=value lines we parse back. Cheap to
      // implement and easy to extend.
      const cmd = [
        `echo HOSTNAME=$(hostname)`,
        `echo OS_RELEASE="$(grep '^PRETTY_NAME' /etc/os-release 2>/dev/null | cut -d= -f2 | tr -d '\\"' || uname -s)"`,
        `echo CPU_COUNT=$(nproc 2>/dev/null || echo 1)`,
        `echo LOAD1=$(awk '{print $1}' /proc/loadavg 2>/dev/null)`,
        `echo UPTIME=$(awk '{print int($1)}' /proc/uptime 2>/dev/null)`,
        `echo MEM_TOTAL_KB=$(awk '/MemTotal/ {print $2}' /proc/meminfo 2>/dev/null)`,
        `echo MEM_AVAIL_KB=$(awk '/MemAvailable/ {print $2}' /proc/meminfo 2>/dev/null)`,
        `echo DISK="$(df -PBM / 2>/dev/null | tail -n1 | awk '{print $2"|"$3"|"$4}')"`,
      ].join('; ');
      const r = await runOnHost(cmd, withServer(sid, opts));
      if (r.code !== 0) return null;
      const fields: Record<string, string> = {};
      for (const line of r.stdout.split('\n')) {
        const eq = line.indexOf('=');
        if (eq < 0) continue;
        fields[line.slice(0, eq)] = line.slice(eq + 1).trim();
      }
      const memTotalKb = parseInt(fields.MEM_TOTAL_KB ?? '0', 10) || 0;
      const memAvailKb = parseInt(fields.MEM_AVAIL_KB ?? '0', 10) || 0;
      const memUsedKb = memTotalKb - memAvailKb;
      const [diskTotalMb, diskUsedMb, diskFreeMb] = (fields.DISK ?? '||')
        .split('|')
        .map((s) => parseInt(s.replace(/M$/, ''), 10) || 0);
      return {
        hostname: fields.HOSTNAME ?? null,
        osRelease: fields.OS_RELEASE ?? null,
        cpuCount: parseInt(fields.CPU_COUNT ?? '0', 10) || null,
        cpuLoad1m: parseFloat(fields.LOAD1 ?? '0') || null,
        uptimeSec: parseInt(fields.UPTIME ?? '0', 10) || null,
        memTotalMb: Math.round(memTotalKb / 1024) || null,
        memUsedMb: Math.round(memUsedKb / 1024) || null,
        memFreeMb: Math.round(memAvailKb / 1024) || null,
        diskTotalGb: Math.round((diskTotalMb ?? 0) / 1024) || null,
        diskUsedGb: Math.round((diskUsedMb ?? 0) / 1024) || null,
        diskFreeGb: Math.round((diskFreeMb ?? 0) / 1024) || null,
      };
    },

    async gpu(opts) {
      // Best-effort nvidia-smi; everything else is in host-probe.ts and we
      // don't want to duplicate the lspci fallback here.
      const nv = await runOnHost(
        `nvidia-smi --query-gpu=name,driver_version,memory.total,memory.used,memory.free,utilization.gpu,utilization.memory,temperature.gpu,power.draw --format=csv,noheader,nounits 2>/dev/null`,
        withServer(sid, opts),
      );
      if (nv.code !== 0 || !nv.stdout.trim()) return [];
      const out: HostGpu[] = [];
      for (const line of nv.stdout.split('\n')) {
        const cols = line.split(',').map((c) => c.trim());
        if (cols.length < 9) continue;
        out.push({
          vendor: 'NVIDIA',
          model: cols[0] ?? null,
          driver: cols[1] ?? null,
          vramMb: parseInt(cols[2] ?? '0', 10) || null,
          vramUsedMb: parseInt(cols[3] ?? '0', 10) || null,
          vramFreeMb: parseInt(cols[4] ?? '0', 10) || null,
          loadPct: parseInt(cols[5] ?? '0', 10) || null,
          memLoadPct: parseInt(cols[6] ?? '0', 10) || null,
          tempC: parseInt(cols[7] ?? '0', 10) || null,
          powerW: parseFloat(cols[8] ?? '0') || null,
        });
      }
      return out;
    },

    // ---------------- Docker on this host ----------------

    getDockerSocket() {
      return process.env.DOCKER_SOCKET || '/var/run/docker.sock';
    },

    async dockerVersion(opts) {
      const r = await runOnHost(
        `docker version --format '{{json .Server}}' 2>/dev/null`,
        withServer(sid, opts),
      );
      if (r.code !== 0 || !r.stdout.trim()) return null;
      try {
        const j = JSON.parse(r.stdout.trim()) as { Version?: string; ApiVersion?: string };
        return { version: j.Version ?? '?', api: j.ApiVersion ?? '?' };
      } catch {
        return null;
      }
    },

    // ---------------- Escape hatch ----------------

    async runScript(script, opts): Promise<RunResult> {
      return runOnHost(script, withServer(sid, opts));
    },

    async runScriptWithStdin(script, stdin, opts): Promise<RunResult> {
      return runOnHostStdin(script, stdin, withServer(sid, opts));
    },
  };
}
