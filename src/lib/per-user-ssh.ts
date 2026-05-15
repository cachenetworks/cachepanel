// Manages per-user SSH provisioning (Option A in the design).
// Each panel user can be granted their own Linux account on the host. The
// keypair lives at /run/secrets/users/<userId>/{id_ed25519,id_ed25519.pub}
// inside the container; the host install script bind-mounts ./secrets there.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { runOnHost, isSshConfigured } from './host-probe';
import { getServerById, resolveSshSpec, sshArgs } from './servers';

const SECRETS_BASE = process.env.PER_USER_SECRETS_DIR || '/run/secrets-users';
// scripts/ inside the container is shipped via the Dockerfile.
const PROVISION_SCRIPT = '/app/scripts/provision-user.sh';

export interface UserKeyPaths {
  dir: string;
  privateKey: string;
  publicKey: string;
}

export function userKeyPaths(userId: string): UserKeyPaths {
  const dir = path.join(SECRETS_BASE, userId);
  return {
    dir,
    privateKey: path.join(dir, 'id_ed25519'),
    publicKey: path.join(dir, 'id_ed25519.pub'),
  };
}

export function hasUserKey(userId: string): boolean {
  const { privateKey, publicKey } = userKeyPaths(userId);
  return fs.existsSync(privateKey) && fs.existsSync(publicKey);
}

export async function ensureUserKey(userId: string): Promise<{ pubkey: string }> {
  const { dir, privateKey, publicKey } = userKeyPaths(userId);
  await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
  if (!fs.existsSync(privateKey)) {
    // Generate a fresh ed25519 key with no passphrase. ssh-keygen comes from
    // openssh-client, which is already installed in the container.
    const r = spawnSync('ssh-keygen', [
      '-q',
      '-t', 'ed25519',
      '-N', '',
      '-C', `cachepanel-user-${userId}`,
      '-f', privateKey,
    ]);
    if (r.status !== 0) {
      throw new Error(
        `ssh-keygen failed: ${r.stderr?.toString() || r.stdout?.toString() || `exit ${r.status}`}`,
      );
    }
  }
  const pubkey = (await fsp.readFile(publicKey, 'utf-8')).trim();
  return { pubkey };
}

export async function deleteUserKey(userId: string): Promise<void> {
  const { dir } = userKeyPaths(userId);
  await fsp.rm(dir, { recursive: true, force: true });
}

// Sanitize a Discord username into a Linux-account-friendly handle.
// Lowercase, alphanumeric + underscore + dash, must start with a letter or _,
// max 32 chars, prefixed with "cp-" so we don't collide with system accounts.
export function suggestLinuxUsername(seed: string): string {
  let s = seed.toLowerCase();
  s = s.replace(/[^a-z0-9_-]+/g, '');
  s = s.replace(/^[^a-z_]+/, '');
  if (!s) s = 'user';
  s = s.slice(0, 28);
  return `cp-${s}`;
}

export function isValidLinuxUsername(name: string): boolean {
  return /^[a-z_][a-z0-9_-]{0,31}$/.test(name);
}

// Pipe stdin into an ssh exec on the chosen server. Used to ship the
// provisioning script as `bash -s` to the host.
async function runOnHostWithStdin(
  command: string,
  stdin: string,
  serverId?: string | null,
  timeoutMs = 30_000,
): Promise<{ stdout: string; stderr: string; code: number }> {
  const server = await getServerById(serverId);
  if (!server) return { stdout: '', stderr: 'No server configured', code: -1 };
  // Provisioning needs the global service account (not the user's own
  // unprivileged login), so we pass userId=null to resolveSshSpec.
  const spec = await resolveSshSpec(server, null);
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
    child.stdin.end(stdin);
  });
}

// Read the provisioning script and stream it to the host so we don't depend
// on the script existing on the host — the panel ships its own copy.
async function runProvisionScript(
  args: string[],
  serverId?: string | null,
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const script = await fsp.readFile(PROVISION_SCRIPT, 'utf-8').catch(() => null);
  if (!script) {
    return { ok: false, stdout: '', stderr: `Provisioning script missing at ${PROVISION_SCRIPT}` };
  }
  const quoted = args.map((a) => `'${a.replace(/'/g, `'\\''`)}'`).join(' ');
  const cmd = `bash -s -- ${quoted}`;
  const r = await runOnHostWithStdin(cmd, script, serverId ?? null);
  return { ok: r.code === 0, stdout: r.stdout, stderr: r.stderr };
}

export async function provisionUserOnHost(opts: {
  username: string;
  pubkey: string;
  sudo: boolean;
  serverId?: string | null;
}): Promise<{ ok: boolean; message: string }> {
  if (!isValidLinuxUsername(opts.username)) {
    return { ok: false, message: `Invalid Linux username: ${opts.username}` };
  }
  const pubkeyB64 = Buffer.from(opts.pubkey, 'utf-8').toString('base64');
  const create = await runProvisionScript(['create', opts.username, pubkeyB64], opts.serverId);
  if (!create.ok) return { ok: false, message: `create: ${create.stderr || create.stdout}` };
  const sudo = await runProvisionScript(['sudo', opts.username, opts.sudo ? 'on' : 'off'], opts.serverId);
  if (!sudo.ok) return { ok: false, message: `sudo: ${sudo.stderr || sudo.stdout}` };
  return { ok: true, message: create.stdout + sudo.stdout };
}

export async function disableUserOnHost(username: string, serverId?: string | null): Promise<{ ok: boolean; message: string }> {
  if (!isValidLinuxUsername(username)) {
    return { ok: false, message: `Invalid Linux username: ${username}` };
  }
  const r = await runProvisionScript(['disable', username], serverId);
  return { ok: r.ok, message: r.stderr || r.stdout };
}

export async function deleteUserOnHost(username: string, serverId?: string | null): Promise<{ ok: boolean; message: string }> {
  if (!isValidLinuxUsername(username)) {
    return { ok: false, message: `Invalid Linux username: ${username}` };
  }
  const r = await runProvisionScript(['delete', username], serverId);
  return { ok: r.ok, message: r.stderr || r.stdout };
}

// Quick host-side probe: does the Linux account currently exist?
export async function userExistsOnHost(username: string, serverId?: string | null): Promise<boolean> {
  const r = await runOnHost(`getent passwd ${JSON.stringify(username)} >/dev/null && echo y || echo n`, { serverId });
  return r.code === 0 && r.stdout.trim() === 'y';
}
