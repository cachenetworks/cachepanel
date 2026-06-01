import { NextResponse } from 'next/server';
import http from 'node:http';
import { promises as fs } from 'node:fs';
import { hasValidSetupCookie } from '@/lib/setup-token';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SOCKET_PATH = process.env.DOCKER_SOCKET || '/var/run/docker.sock';

interface DockerVersion {
  Version: string;
  ApiVersion: string;
  Os: string;
  Arch: string;
  Components?: Array<{ Name: string; Version: string }>;
}

// GET (or POST) /api/setup/validate/docker
// Tests whether the panel can talk to /var/run/docker.sock and tells the user
// exactly what to fix when it can't. The classic failure mode is a permissions
// issue: the socket exists but the container's UID isn't in the docker group.
export async function GET() {
  return runCheck();
}
export async function POST() {
  return runCheck();
}

async function runCheck() {
  if (!hasValidSetupCookie()) {
    return NextResponse.json({ ok: false, message: 'Setup session expired.' }, { status: 403 });
  }

  // Stage 1: does the socket file exist (mounted) at all?
  let stat;
  try {
    stat = await fs.stat(SOCKET_PATH);
  } catch (err) {
    const errno = (err as NodeJS.ErrnoException).code;
    if (errno === 'ENOENT') {
      return NextResponse.json({
        ok: false,
        stage: 'socket-missing',
        message: `${SOCKET_PATH} is not mounted into the container. Add this to your docker-compose.yml under cachepanel.volumes: "/var/run/docker.sock:/var/run/docker.sock", then docker compose up -d.`,
      });
    }
    return NextResponse.json({
      ok: false,
      stage: 'socket-stat-error',
      message: `Could not stat ${SOCKET_PATH}: ${(err as Error).message}`,
    });
  }
  if (!stat.isSocket()) {
    return NextResponse.json({
      ok: false,
      stage: 'not-a-socket',
      message: `${SOCKET_PATH} exists but isn't a unix socket. Check your bind mount.`,
    });
  }

  // Stage 2: can we ping the daemon? This tests the EACCES (group permission) case.
  const ping = await dockerPing();
  if (!ping.ok) {
    if (ping.errno === 'EACCES' || /permission denied/i.test(ping.message)) {
      const gid = (stat as unknown as { gid: number }).gid;
      return NextResponse.json({
        ok: false,
        stage: 'permission-denied',
        socketGid: gid,
        message: `Permission denied reading ${SOCKET_PATH}. The socket is owned by GID ${gid} on the host — add "${gid}" to the cachepanel service's group_add list in docker-compose.yml, then recreate the container.`,
      });
    }
    return NextResponse.json({
      ok: false,
      stage: 'ping-failed',
      message: `Docker daemon didn't respond: ${ping.message}`,
    });
  }

  // Stage 3: pull /version for a friendly success summary.
  const version = await dockerVersion();
  if (!version.ok) {
    return NextResponse.json({
      ok: true,
      stage: 'connected-no-version',
      message: 'Socket reachable but /version returned an error. Old Docker version?',
    });
  }
  const v = version.data;
  const compose = v.Components?.find((c) => c.Name.toLowerCase().includes('compose'));
  return NextResponse.json({
    ok: true,
    stage: 'connected',
    message: `Connected to Docker ${v.Version} (API ${v.ApiVersion}) on ${v.Os}/${v.Arch}${compose ? ` · Compose ${compose.Version}` : ''}.`,
    version: v.Version,
    apiVersion: v.ApiVersion,
    composeVersion: compose?.Version ?? null,
  });
}

function dockerPing(): Promise<{ ok: boolean; message: string; errno?: string }> {
  return new Promise((resolve) => {
    const req = http.request(
      { socketPath: SOCKET_PATH, path: '/_ping', method: 'GET', timeout: 3000 },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          if (res.statusCode === 200 && body.trim() === 'OK') {
            resolve({ ok: true, message: 'OK' });
          } else {
            resolve({ ok: false, message: `Unexpected ping response: HTTP ${res.statusCode} ${body.slice(0, 80)}` });
          }
        });
      },
    );
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, message: 'Ping timed out after 3s.' });
    });
    req.on('error', (err) => {
      resolve({ ok: false, message: err.message, errno: (err as NodeJS.ErrnoException).code });
    });
    req.end();
  });
}

function dockerVersion(): Promise<{ ok: true; data: DockerVersion } | { ok: false; message: string }> {
  return new Promise((resolve) => {
    const req = http.request(
      { socketPath: SOCKET_PATH, path: '/version', method: 'GET', timeout: 3000 },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          if (res.statusCode !== 200) {
            resolve({ ok: false, message: `HTTP ${res.statusCode}` });
            return;
          }
          try {
            resolve({ ok: true, data: JSON.parse(body) as DockerVersion });
          } catch {
            resolve({ ok: false, message: 'Could not parse /version response.' });
          }
        });
      },
    );
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, message: 'Timed out.' });
    });
    req.on('error', (err) => resolve({ ok: false, message: err.message }));
    req.end();
  });
}
