// Remote-host abstraction. Until v1.8.0 the panel assumed every managed
// server was Linux and shelled out raw POSIX commands (`stat -c`, `find
// -printf`, `crontab`, `/proc/*`). Windows hosts route through a parallel
// PowerShell-based adapter so the rest of the codebase doesn't care which
// OS the target runs.
//
// All commands shipped to the host return JSON whenever possible (the
// PowerShell side serializes with ConvertTo-Json; the Linux side prefers
// `find -printf` blobs but parses to the same shapes). The shapes below
// are the lowest-common-denominator that both adapters fulfil.

import type { Server } from '@prisma/client';

export type RemoteOs = 'linux' | 'windows' | 'unknown';

export interface HostStat {
  type: 'file' | 'directory' | 'symlink';
  size: number;
  modifiedAt: string | null;
}

export interface HostEntry {
  name: string;
  type: 'file' | 'directory' | 'symlink';
  size: number;
  modifiedAt: string | null;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface AdapterCallOpts {
  /** Per-(user, server) account override; null falls back to defaultUser. */
  userId?: string | null;
  timeoutMs?: number;
}

/**
 * RemoteHostAdapter: one method per command family that the panel uses to
 * manage a remote host. Implementations live in `adapters/linux.ts` and
 * `adapters/windows.ts`. Callers should NEVER reach for raw `runOnHost` —
 * use the adapter so the same code path supports both OSes.
 */
export interface RemoteHostAdapter {
  readonly os: RemoteOs;

  // -- Filesystem ----------------------------------------------------------
  listDir(absPath: string, opts?: AdapterCallOpts): Promise<HostEntry[] | null>;
  stat(absPath: string, opts?: AdapterCallOpts): Promise<HostStat | null>;
  readBytes(absPath: string, maxBytes: number, opts?: AdapterCallOpts): Promise<Buffer | null>;
  readText(absPath: string, maxBytes: number, opts?: AdapterCallOpts): Promise<string | null>;
  writeBytes(absPath: string, buf: Buffer, opts?: AdapterCallOpts): Promise<boolean>;
  writeText(absPath: string, content: string, opts?: AdapterCallOpts): Promise<boolean>;
  mkdir(absPath: string, recursive: boolean, opts?: AdapterCallOpts): Promise<boolean>;
  createFile(absPath: string, opts?: AdapterCallOpts): Promise<boolean>;
  remove(absPath: string, recursive: boolean, opts?: AdapterCallOpts): Promise<boolean>;
  move(from: string, to: string, opts?: AdapterCallOpts): Promise<boolean>;

  // -- Scheduled jobs (cron / Task Scheduler) ------------------------------
  listScheduledJobs(opts?: AdapterCallOpts): Promise<string>;
  writeScheduledJobs(content: string, opts?: AdapterCallOpts): Promise<boolean>;
  /** OS-native scheduler creates/updates a single tagged job. Used for the
   * Windows path which can't just splat the whole crontab file. */
  upsertScheduledJob?(args: {
    tag: string;
    cron: string;
    command: string;
    opts?: AdapterCallOpts;
  }): Promise<boolean>;
  deleteScheduledJob?(tag: string, opts?: AdapterCallOpts): Promise<boolean>;

  // -- User provisioning ----------------------------------------------------
  userExists(username: string, opts?: AdapterCallOpts): Promise<boolean>;
  addUser(username: string, opts?: AdapterCallOpts): Promise<RunResult>;
  appendAuthorizedKey(username: string, publicKey: string, opts?: AdapterCallOpts): Promise<RunResult>;

  // -- System probe ---------------------------------------------------------
  /** CPU+memory+disk snapshot. Returns a normalised JSON blob (or null on err). */
  snapshot(opts?: AdapterCallOpts): Promise<HostSnapshot | null>;
  gpu(opts?: AdapterCallOpts): Promise<HostGpu[]>;

  // -- Docker access on this host ------------------------------------------
  /** Where the local Docker daemon listens. Linux: /var/run/docker.sock,
   *  Windows: \\.\pipe\docker_engine. Used by docker-api.ts when the panel
   *  itself runs on this OS. Remote use goes through CLI commands instead. */
  getDockerSocket(): string;
  /** Best-effort `docker version --format '{{json .Server}}'` over SSH. */
  dockerVersion(opts?: AdapterCallOpts): Promise<{ version: string; api: string } | null>;

  // -- Escape hatch ---------------------------------------------------------
  /** Run an arbitrary shell snippet. Avoid; prefer specific methods. */
  runScript(script: string, opts?: AdapterCallOpts): Promise<RunResult>;
  /** Same, with stdin piped in. */
  runScriptWithStdin(script: string, stdin: string, opts?: AdapterCallOpts): Promise<RunResult>;
}

export interface HostSnapshot {
  cpuLoad1m: number | null;
  cpuCount: number | null;
  memTotalMb: number | null;
  memUsedMb: number | null;
  memFreeMb: number | null;
  diskTotalGb: number | null;
  diskUsedGb: number | null;
  diskFreeGb: number | null;
  uptimeSec: number | null;
  hostname: string | null;
  osRelease: string | null;
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

// -- Adapter dispatch --------------------------------------------------------

/**
 * Pick the right adapter for a Server row. Lazy-imports so a host that's
 * never reached doesn't pay the cost of loading the Windows code path.
 */
export async function getAdapter(server: Server): Promise<RemoteHostAdapter> {
  const os = (server.os ?? 'unknown') as RemoteOs;
  if (os === 'windows') {
    const mod = await import('./adapters/windows');
    return mod.makeWindowsAdapter(server);
  }
  // Linux is the default for both "linux" and "unknown" — historical
  // behaviour was Linux-only, and the OS sniff will flip "unknown" → real
  // value on the next connect.
  const mod = await import('./adapters/linux');
  return mod.makeLinuxAdapter(server);
}
