import { NextResponse } from 'next/server';
import http from 'node:http';
import { promises as fs } from 'node:fs';
import { hasValidSetupCookie } from '@/lib/setup-token';
import { getEnv } from '@/lib/env';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// v1.8.0: when the panel itself runs on Windows, the daemon is a named pipe.
// node:http's socketPath option accepts \\.\pipe\<name> on win32 the same way
// it accepts unix sockets on linux, so the ping / version helpers don't need
// changes — only the socket path + stat() guard do.
const IS_WIN32_PANEL = process.platform === 'win32';
const SOCKET_PATH = process.env.DOCKER_SOCKET ||
  (IS_WIN32_PANEL ? '//./pipe/docker_engine' : '/var/run/docker.sock');

function fixDockerOneliner(): string {
  const base = getEnv().NEXTAUTH_URL.replace(/\/+$/, '');
  if (IS_WIN32_PANEL) {
    return `iwr "${base}/api/setup/fix-docker?fmt=ps1" -UseBasicParsing | Select-Object -ExpandProperty Content | iex`;
  }
  return `curl -fsSL "${base}/api/setup/fix-docker?fmt=sh" | sudo bash`;
}

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
  // On Windows, the daemon is a named pipe — not a regular FS entry —
  // so fs.stat throws ENOENT/EBUSY/etc unhelpfully. Skip the stat and
  // let the ping decide whether the daemon is reachable.
  let stat: import('node:fs').Stats | null = null;
  if (!IS_WIN32_PANEL) {
    try {
      stat = await fs.stat(SOCKET_PATH);
    } catch (err) {
      const errno = (err as NodeJS.ErrnoException).code;
      if (errno === 'ENOENT') {
        return NextResponse.json({
          ok: false,
          stage: 'socket-missing',
          autoFixOneliner: fixDockerOneliner(),
          message: `${SOCKET_PATH} is not mounted into the container. The wizard can fix this for you — run the one-liner below on the host (it'll also add the bind mount if missing).`,
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
  }

  // Stage 2: can we ping the daemon? This tests the EACCES (group permission) case.
  const ping = await dockerPing();
  if (!ping.ok) {
    if (ping.errno === 'EACCES' || /permission denied|Access is denied/i.test(ping.message)) {
      const gid = stat ? (stat as unknown as { gid: number }).gid : null;
      return NextResponse.json({
        ok: false,
        stage: 'permission-denied',
        socketGid: gid,
        autoFixOneliner: fixDockerOneliner(),
        message: IS_WIN32_PANEL
          ? `Docker named pipe denied access. The current user isn't in the 'docker-users' Windows group — run the PowerShell one-liner below on the panel host to fix it.`
          : `Permission denied reading ${SOCKET_PATH}. The socket is owned by GID ${gid} on the host. The wizard can fix this for you — run the one-liner below on the host.`,
      });
    }
    if (IS_WIN32_PANEL && /ENOENT|cannot find|pipe.*not.*found/i.test(ping.message)) {
      // Daemon not running OR Docker Desktop not installed.
      return NextResponse.json({
        ok: false,
        stage: 'socket-missing',
        autoFixOneliner: fixDockerOneliner(),
        message: `Docker Desktop isn't running (or isn't installed) on this Windows host. Start it from the system tray, or run the PowerShell one-liner below to install it.`,
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
