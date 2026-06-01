import { NextResponse } from 'next/server';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { authorize } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { audit } from '@/lib/audit';
import { getClientIp } from '@/lib/ip';
import { getServerById, resolveSshSpec } from '@/lib/servers';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Same writable location as the setup endpoint.
const SECRETS_DIR = process.env.RUNTIME_SECRETS_DIR || '/run/secrets-servers';

const bodySchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9_-]{0,62}[a-z0-9]?$/),
  hostname: z.string().min(1).max(253),
  port: z.number().int().min(1).max(65535).optional(),
  defaultUser: z.string().min(1).max(64),
  keyName: z.string().min(1).max(255),
  tags: z.string().max(255).optional(),
  notes: z.string().max(1024).optional(),
});

function sshKeyscan(hostname: string, port: number): Promise<{ ok: boolean; output: string; error?: string }> {
  return new Promise((resolve) => {
    const child = spawn('ssh-keyscan', ['-T', '5', '-p', String(port), hostname]);
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 8000);
    child.stdout.on('data', (b) => (out += b.toString()));
    child.stderr.on('data', (b) => (err += b.toString()));
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && out.trim()) resolve({ ok: true, output: out });
      else resolve({ ok: false, output: out, error: err.trim() || `ssh-keyscan exited ${code}` });
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, output: '', error: e.message });
    });
  });
}

function trySshOnce(opts: {
  hostname: string;
  port: number;
  user: string;
  keyPath: string;
  knownHostsPath: string;
}): Promise<{ ok: boolean; output: string; error?: string }> {
  return new Promise((resolve) => {
    const child = spawn('ssh', [
      '-i', opts.keyPath,
      '-o', 'BatchMode=yes',
      '-o', 'ConnectTimeout=5',
      '-o', 'StrictHostKeyChecking=yes',
      '-o', `UserKnownHostsFile=${opts.knownHostsPath}`,
      '-p', String(opts.port),
      `${opts.user}@${opts.hostname}`,
      'echo OK; whoami; uname -a',
    ]);
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
    child.stdout.on('data', (b) => (out += b.toString()));
    child.stderr.on('data', (b) => (err += b.toString()));
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ ok: true, output: out });
      else resolve({ ok: false, output: out, error: err.trim() || `ssh exited ${code}` });
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, output: '', error: e.message });
    });
  });
}

// Probe the remote host's docker daemon over the same SSH connection. We
// run `docker version` and a getent-based GID lookup in a single round trip
// so the failure modes (no docker, no perms, no group membership) map to
// the same UX the local Docker validator uses.
//
// Output is a small JSON-ish blob the route returns to the wizard, which
// then either says "Docker is reachable" or surfaces an auto-fix hint.
interface RemoteDockerCheck {
  ok: boolean;
  stage:
    | 'connected'
    | 'no-docker'
    | 'permission-denied'
    | 'no-socket'
    | 'unknown'
    | 'ssh-failed';
  message: string;
  /** GID of the docker group on the remote host (if we could detect it). */
  socketGid?: number;
  /** Docker version string if we got it. */
  version?: string;
  /** Suggested command the user runs on the remote host to fix the issue. */
  fixHint?: string;
}

function probeRemoteDocker(opts: {
  hostname: string;
  port: number;
  user: string;
  keyPath: string;
  knownHostsPath: string;
}): Promise<RemoteDockerCheck> {
  // One shell pipeline so we only pay one SSH round-trip. The script writes
  // a small key=value blob we parse back.
  // - SOCK_EXISTS: 0/1 from `test -S`
  // - SOCK_GID: numeric GID of the socket (best effort)
  // - DOCKER_OUT: stdout of `docker version --format ...` (or empty)
  // - DOCKER_ERR: stderr of same, head 200 chars
  // - DOCKER_RC: exit code of the docker call
  const script = `set +e
SOCK=/var/run/docker.sock
if [ -S "$SOCK" ]; then SOCK_EXISTS=1; else SOCK_EXISTS=0; fi
SOCK_GID=$(stat -c '%g' "$SOCK" 2>/dev/null || stat -f '%g' "$SOCK" 2>/dev/null)
DOCKER_OUT=$(docker version --format '{{.Server.Version}}' 2>/tmp/cp.derr)
DOCKER_RC=$?
DOCKER_ERR=$(head -c 200 /tmp/cp.derr 2>/dev/null)
rm -f /tmp/cp.derr 2>/dev/null
printf 'SOCK_EXISTS=%s\\nSOCK_GID=%s\\nDOCKER_OUT=%s\\nDOCKER_RC=%s\\nDOCKER_ERR=%s\\n' "$SOCK_EXISTS" "$SOCK_GID" "$DOCKER_OUT" "$DOCKER_RC" "$DOCKER_ERR"`;
  return new Promise((resolve) => {
    const child = spawn('ssh', [
      '-i', opts.keyPath,
      '-o', 'BatchMode=yes',
      '-o', 'ConnectTimeout=5',
      '-o', 'StrictHostKeyChecking=yes',
      '-o', `UserKnownHostsFile=${opts.knownHostsPath}`,
      '-p', String(opts.port),
      `${opts.user}@${opts.hostname}`,
      script,
    ]);
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
    child.stdout.on('data', (b) => (out += b.toString()));
    child.stderr.on('data', (b) => (err += b.toString()));
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        resolve({
          ok: false,
          stage: 'ssh-failed',
          message: `SSH probe failed: ${err.trim() || `exit ${code}`}`,
        });
        return;
      }
      const fields = parseKv(out);
      const sockExists = fields.SOCK_EXISTS === '1';
      const sockGid = fields.SOCK_GID ? parseInt(fields.SOCK_GID, 10) : undefined;
      const dockerRc = fields.DOCKER_RC ? parseInt(fields.DOCKER_RC, 10) : 1;
      const dockerErr = fields.DOCKER_ERR ?? '';
      const dockerOut = fields.DOCKER_OUT ?? '';

      if (dockerRc === 0 && dockerOut) {
        resolve({
          ok: true,
          stage: 'connected',
          version: dockerOut,
          socketGid: sockGid,
          message: `Docker ${dockerOut} reachable as ${opts.user}.`,
        });
        return;
      }
      if (!sockExists) {
        resolve({
          ok: false,
          stage: 'no-socket',
          message: `No /var/run/docker.sock on ${opts.hostname} — Docker isn't installed (or isn't running). Install Docker on the host first.`,
          fixHint: `curl -fsSL https://get.docker.com | sudo sh && sudo systemctl enable --now docker`,
        });
        return;
      }
      if (/permission denied/i.test(dockerErr) || /cannot connect.*Got permission/i.test(dockerErr)) {
        // Classic group-membership case. We CAN auto-fix this — usermod +
        // log out / log in. We hand the user the exact command.
        resolve({
          ok: false,
          stage: 'permission-denied',
          socketGid: sockGid,
          message: `SSH user ${opts.user} can't access the docker socket on ${opts.hostname}. Add ${opts.user} to the docker group, then re-test.`,
          fixHint: `sudo usermod -aG docker ${opts.user} && sudo systemctl restart docker`,
        });
        return;
      }
      if (/command not found|docker: not found/i.test(dockerErr)) {
        resolve({
          ok: false,
          stage: 'no-docker',
          message: `The docker CLI isn't installed for ${opts.user} on ${opts.hostname}.`,
          fixHint: `curl -fsSL https://get.docker.com | sudo sh`,
        });
        return;
      }
      resolve({
        ok: false,
        stage: 'unknown',
        message: dockerErr.trim() || `docker exited ${dockerRc} with no error output.`,
      });
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, stage: 'ssh-failed', message: e.message });
    });
  });
}

function parseKv(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of s.split('\n')) {
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    out[line.slice(0, eq)] = line.slice(eq + 1).trim();
  }
  return out;
}

export async function POST(req: Request) {
  const auth = await authorize({ requireOwner: true });
  if (!auth.ok) return auth.response;

  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body', issues: parsed.error.issues }, { status: 400 });
  }
  const { name, hostname, port = 22, defaultUser, keyName, tags = '', notes = '' } = parsed.data;

  const keyPath = path.join(SECRETS_DIR, keyName);
  if (!fs.existsSync(keyPath)) {
    return NextResponse.json(
      { error: `Private key ${keyName} is missing — re-run the setup step.` },
      { status: 400 },
    );
  }

  // Capture the host key fresh and write it to a per-server known_hosts so
  // we don't pollute the global one. Filename mirrors the key.
  const knownHostsName = `${keyName}.known_hosts`;
  const knownHostsPath = path.join(SECRETS_DIR, knownHostsName);

  const scan = await sshKeyscan(hostname, port);
  if (!scan.ok) {
    return NextResponse.json(
      { error: `Could not capture host key from ${hostname}:${port} — ${scan.error}` },
      { status: 500 },
    );
  }
  await fsp.writeFile(knownHostsPath, scan.output, 'utf-8');
  await fsp.chmod(knownHostsPath, 0o644).catch(() => undefined);

  // Verify we can actually log in.
  const probe = await trySshOnce({ hostname, port, user: defaultUser, keyPath, knownHostsPath });
  if (!probe.ok) {
    return NextResponse.json(
      {
        error:
          `Could capture host key, but the SSH login as ${defaultUser}@${hostname} failed — ` +
          probe.error +
          `. Double-check the public key was appended to ~${defaultUser}/.ssh/authorized_keys on the remote box.`,
      },
      { status: 400 },
    );
  }

  // SSH works — probe the remote docker daemon as a separate, non-fatal check.
  // We surface the result to the wizard so the user can see + fix it before
  // closing the dialog, but we never block server creation on a docker
  // failure (the server might be a non-docker host they want for SSH only).
  const dockerCheck = await probeRemoteDocker({
    hostname,
    port,
    user: defaultUser,
    keyPath,
    knownHostsPath,
  });

  // Persist the Server row.
  let created;
  try {
    created = await prisma.server.create({
      data: {
        name,
        hostname,
        port,
        defaultUser,
        keyName,
        knownHostsName,
        tags,
        notes: notes || null,
        addedById: auth.user.id,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'A server with that name already exists, or another DB error: ' + (err instanceof Error ? err.message : String(err)) },
      { status: 400 },
    );
  }

  await audit({
    userId: auth.user.id,
    action: 'settings.changed',
    target: `server:${created.id}`,
    metadata: { event: 'server.created.via_wizard', name, hostname },
    ipAddress: getClientIp(req),
  });

  return NextResponse.json({
    server: created,
    probe: probe.output.trim(),
    dockerCheck,
  });
}

// Allow the wizard's Step3 to re-test docker without re-running the whole
// create flow (e.g. after the user ran the suggested usermod and SSHed
// back out + in to refresh group membership). Server-id keyed so we can
// look up the SSH spec via the existing servers lib.
export async function GET(req: Request) {
  const auth = await authorize({ requireOwner: true });
  if (!auth.ok) return auth.response;
  const url = new URL(req.url);
  const serverId = url.searchParams.get('serverId');
  if (!serverId) {
    return NextResponse.json({ error: 'serverId required' }, { status: 400 });
  }
  const server = await getServerById(serverId);
  if (!server) return NextResponse.json({ error: 'Server not found' }, { status: 404 });
  const spec = await resolveSshSpec(server, auth.user.id);
  const dockerCheck = await probeRemoteDocker({
    hostname: spec.host,
    port: spec.port,
    user: spec.user,
    keyPath: spec.keyPath,
    knownHostsPath: spec.knownHosts,
  });
  return NextResponse.json({ dockerCheck });
}
