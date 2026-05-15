import { NextResponse } from 'next/server';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { authorize } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { audit } from '@/lib/audit';
import { getClientIp } from '@/lib/ip';
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
  });
}
