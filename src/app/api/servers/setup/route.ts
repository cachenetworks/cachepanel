import { NextResponse } from 'next/server';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { authorize } from '@/lib/api-auth';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Runtime-generated keys go to a writable bind mount. The read-only
// /run/secrets dir holds keys that were placed there before container start.
const SECRETS_DIR = process.env.RUNTIME_SECRETS_DIR || '/run/secrets-servers';

const bodySchema = z.object({
  // Tentative name for the new server. We use it to derive the key filename.
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9_-]{0,62}[a-z0-9]?$/, 'lowercase letters, digits, _ and -; start/end with alnum'),
  hostname: z.string().min(1).max(253),
  port: z.number().int().min(1).max(65535).optional(),
  remoteUser: z.string().min(1).max(64),
});

// POST — generate the keypair (idempotent) and return the public key plus the
// `ssh-copy-id`-style command the user should run on the remote box.
export async function POST(req: Request) {
  const auth = await authorize({ requireOwner: true });
  if (!auth.ok) return auth.response;

  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body', issues: parsed.error.issues }, { status: 400 });
  }
  const { name, hostname, port = 22, remoteUser } = parsed.data;

  const keyName = `cachepanel_${name.replace(/[^a-z0-9_-]/g, '_')}`;
  const privPath = path.join(SECRETS_DIR, keyName);
  const pubPath = `${privPath}.pub`;

  await fsp.mkdir(SECRETS_DIR, { recursive: true }).catch(() => undefined);
  if (!fs.existsSync(privPath)) {
    const r = spawnSync('ssh-keygen', [
      '-q',
      '-t', 'ed25519',
      '-N', '',
      '-C', `cachepanel-${name}`,
      '-f', privPath,
    ]);
    if (r.status !== 0) {
      return NextResponse.json(
        {
          error: 'ssh-keygen failed: ' + (r.stderr?.toString() || `exit ${r.status}`),
        },
        { status: 500 },
      );
    }
    // Best-effort lock-down. Container runs as UID 1001; that's already us.
    await fsp.chmod(privPath, 0o600).catch(() => undefined);
    await fsp.chmod(pubPath, 0o644).catch(() => undefined);
  }

  const pubkey = (await fsp.readFile(pubPath, 'utf-8')).trim();

  // The host can already reach the new box → run ssh-copy-id from the
  // primary. Easier than asking the user to paste anything.
  const sshCopyIdCommand =
    `mkdir -p ~/.ssh && chmod 700 ~/.ssh && ` +
    `echo ${JSON.stringify(pubkey)} >> ~/.ssh/authorized_keys && ` +
    `chmod 600 ~/.ssh/authorized_keys && ` +
    `echo OK`;

  return NextResponse.json({
    keyName,
    publicKey: pubkey,
    // Shown to the user as the *one* command they paste on the remote machine
    // while logged in as `remoteUser`.
    remoteCommand: sshCopyIdCommand,
    // Convenience: a from-the-laptop one-liner if the user wants to do it the
    // classic way through their own SSH agent.
    sshCopyIdLine: `# (run from your laptop, requires you have ${remoteUser}@${hostname} access)\n` +
      `cat <<'EOF' | ssh -p ${port} ${remoteUser}@${hostname} 'mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys'\n${pubkey}\nEOF`,
    hostname,
    port,
    remoteUser,
    name,
  });
}
