// Talk to the local Docker daemon directly over its unix socket (Linux) or
// Windows named pipe (when the panel is installed natively on Windows).
// Avoids systeminformation's partial-data quirks and works as long as the
// container can read the daemon endpoint.

import http from 'node:http';

// v1.8.0: pick the right transport endpoint at module load. Both unix
// sockets and Windows named pipes are addressable via http.request's
// `socketPath` option — Node passes whatever string you give to its
// platform-specific connect() — so we only need to switch the path.
const SOCKET_PATH =
  process.env.DOCKER_SOCKET ||
  (process.platform === 'win32' ? '//./pipe/docker_engine' : '/var/run/docker.sock');

function request<T>(path: string, method = 'GET'): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        socketPath: SOCKET_PATH,
        path,
        method,
        timeout: 5000,
      },
      (res) => {
        let body = '';
        res.setEncoding('utf-8');
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          if (!res.statusCode || res.statusCode >= 400) {
            reject(new Error(`Docker API ${res.statusCode}: ${body.slice(0, 200)}`));
            return;
          }
          if (!body) {
            resolve(undefined as T);
            return;
          }
          try {
            resolve(JSON.parse(body) as T);
          } catch (err) {
            reject(err);
          }
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('Docker API timeout')));
    req.on('error', reject);
    req.end();
  });
}

// Helper for endpoints that don't return JSON (POST start/stop/etc, log streams).
// Returns the raw body bytes so binary-framed responses (logs) survive.
function rawRequest(opts: { path: string; method?: string }): Promise<{ status: number; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        socketPath: SOCKET_PATH,
        path: opts.path,
        method: opts.method ?? 'GET',
        timeout: 30_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }));
      },
    );
    req.on('timeout', () => req.destroy(new Error('Docker API timeout')));
    req.on('error', reject);
    req.end();
  });
}

export interface DockerInfo {
  available: boolean;
  containers: number;
  running: number;
  paused: number;
  stopped: number;
  images: number;
  serverVersion?: string;
  error?: string;
}

export async function getDockerInfo(): Promise<DockerInfo> {
  try {
    const info = await request<{
      Containers: number;
      ContainersRunning: number;
      ContainersPaused: number;
      ContainersStopped: number;
      Images: number;
      ServerVersion: string;
    }>('/v1.41/info');
    return {
      available: true,
      containers: info.Containers ?? 0,
      running: info.ContainersRunning ?? 0,
      paused: info.ContainersPaused ?? 0,
      stopped: info.ContainersStopped ?? 0,
      images: info.Images ?? 0,
      serverVersion: info.ServerVersion,
    };
  } catch (err) {
    return {
      available: false,
      containers: 0,
      running: 0,
      paused: 0,
      stopped: 0,
      images: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface DockerMount {
  type: 'bind' | 'volume' | 'tmpfs' | string;
  /** Host-side path. For named volumes this is /var/lib/docker/volumes/<name>/_data. */
  source: string;
  /** Path inside the container. */
  destination: string;
  /** Volume name (only set when type === 'volume'). */
  name: string | null;
  readOnly: boolean;
}

export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  createdAt: string;
  ports: Array<{ private: number; public: number | null; type: string; ip: string | null }>;
  mounts: DockerMount[];
}

interface ApiMount {
  Type?: string;
  Source?: string;
  Destination?: string;
  Name?: string;
  RW?: boolean;
}

interface ApiContainer {
  Id: string;
  Names: string[];
  Image: string;
  State: string;
  Status: string;
  Created: number;
  Ports?: Array<{ PrivatePort: number; PublicPort?: number; Type?: string; IP?: string }>;
  Mounts?: ApiMount[];
}

export async function listContainers(): Promise<DockerContainer[]> {
  try {
    const arr = await request<ApiContainer[]>('/v1.41/containers/json?all=true');
    return arr.map((c) => ({
      id: c.Id.slice(0, 12),
      name: (c.Names?.[0] ?? '').replace(/^\//, ''),
      image: c.Image,
      state: c.State,
      status: c.Status,
      createdAt: new Date(c.Created * 1000).toISOString(),
      ports: (c.Ports ?? []).map((p) => ({
        private: p.PrivatePort,
        public: p.PublicPort ?? null,
        type: p.Type ?? 'tcp',
        ip: p.IP ?? null,
      })),
      mounts: (c.Mounts ?? []).map((m) => ({
        type: (m.Type ?? 'bind') as DockerMount['type'],
        source: m.Source ?? '',
        destination: m.Destination ?? '',
        name: m.Name ?? null,
        readOnly: m.RW === false,
      })),
    }));
  } catch {
    return [];
  }
}

export interface DockerStats {
  cpuPct: number;
  memUsed: number;
  memLimit: number;
}

// Container stats — Docker's /stats endpoint streams by default; pass stream=false
// to get a single snapshot. Called per-container so we Promise.all in the route.
export async function getContainerStats(id: string): Promise<DockerStats | null> {
  try {
    const s = await request<{
      cpu_stats: {
        cpu_usage: { total_usage: number };
        system_cpu_usage: number;
        online_cpus?: number;
      };
      precpu_stats: {
        cpu_usage: { total_usage: number };
        system_cpu_usage: number;
      };
      memory_stats: { usage?: number; limit?: number };
    }>(`/v1.41/containers/${id}/stats?stream=false`);

    const cpuDelta = s.cpu_stats.cpu_usage.total_usage - s.precpu_stats.cpu_usage.total_usage;
    const sysDelta = s.cpu_stats.system_cpu_usage - s.precpu_stats.system_cpu_usage;
    const onlineCpus = s.cpu_stats.online_cpus ?? 1;
    const cpuPct = sysDelta > 0 && cpuDelta > 0 ? (cpuDelta / sysDelta) * onlineCpus * 100 : 0;

    return {
      cpuPct,
      memUsed: s.memory_stats.usage ?? 0,
      memLimit: s.memory_stats.limit ?? 0,
    };
  } catch {
    return null;
  }
}

// ---------- Container actions ----------

export type ContainerAction = 'start' | 'stop' | 'restart' | 'pause' | 'unpause' | 'kill';

export async function containerAction(id: string, action: ContainerAction): Promise<void> {
  // Docker returns 204 (no content) on success, 304 if already in target state,
  // 404 if missing, and 409 for invalid state transitions. Treat 2xx and 304 as ok.
  const res = await rawRequest({ path: `/v1.41/containers/${id}/${action}`, method: 'POST' });
  if (res.status >= 400 && res.status !== 304) {
    throw new Error(`Docker ${action} failed (${res.status}): ${res.body.toString('utf-8').slice(0, 200)}`);
  }
}

export async function removeContainer(id: string, force: boolean): Promise<void> {
  const qs = force ? '?force=true' : '';
  const res = await rawRequest({ path: `/v1.41/containers/${id}${qs}`, method: 'DELETE' });
  if (res.status >= 400) {
    throw new Error(`Docker remove failed (${res.status}): ${res.body.toString('utf-8').slice(0, 200)}`);
  }
}

// ---------- Logs ----------

// Docker log streams use a custom 8-byte multiplexed framing when the container
// has no TTY: [stream-type, 0, 0, 0, size_be32, ...payload]. We strip headers
// and concatenate stdout/stderr into plain text for the UI.
function demuxDockerLogs(buf: Buffer): string {
  const out: string[] = [];
  let i = 0;
  while (i + 8 <= buf.length) {
    const streamType = buf[i];
    if (streamType !== 0 && streamType !== 1 && streamType !== 2) {
      // Not a header — must be raw text (TTY mode). Dump the rest verbatim.
      out.push(buf.slice(i).toString('utf-8'));
      break;
    }
    const size = buf.readUInt32BE(i + 4);
    const start = i + 8;
    const end = start + size;
    if (end > buf.length) break;
    out.push(buf.slice(start, end).toString('utf-8'));
    i = end;
  }
  return out.join('');
}

export async function getContainerLogs(id: string, tail = 200): Promise<string> {
  const res = await rawRequest({
    path: `/v1.41/containers/${id}/logs?stdout=true&stderr=true&tail=${tail}&timestamps=false`,
    method: 'GET',
  });
  if (res.status >= 400) {
    throw new Error(`Logs failed (${res.status}): ${res.body.toString('utf-8').slice(0, 200)}`);
  }
  return demuxDockerLogs(res.body);
}
