// Server registry. Picks the right SSH config for any host the panel manages.

import path from 'node:path';
import fs from 'node:fs';
import { prisma } from './prisma';
import type { Server } from '@prisma/client';
import { getConfig } from './config';
import { resetUsingHostCache } from './host-fs';

const SECRETS_DIR = process.env.SECRETS_DIR || '/run/secrets';
const RUNTIME_SECRETS_DIR = process.env.RUNTIME_SECRETS_DIR || '/run/secrets-servers';
const PER_USER_SECRETS_DIR = process.env.PER_USER_SECRETS_DIR || '/run/secrets-users';

// Resolve a key/known_hosts filename to an absolute path. Prefer the writable
// runtime dir (where the wizard saves files) and fall back to the read-only
// /run/secrets where pre-baked keys live.
function resolveSecretPath(filename: string): string {
  const runtimePath = path.join(RUNTIME_SECRETS_DIR, filename);
  if (fs.existsSync(runtimePath)) return runtimePath;
  return path.join(SECRETS_DIR, filename);
}

export interface SshSpec {
  host: string;
  port: number;
  user: string;
  keyPath: string;
  knownHosts: string;
}

export function isMultiServerConfigured(): boolean {
  // The schema migration creates the Server table; the boot helper below
  // ensures at least the primary exists. So if we have a Server, we're good.
  return true;
}

// Lazily ensure that a "primary" Server exists. Reads from getConfig (the
// v1.7+ home for SSH-to-host settings) and falls back to SSH_* env vars for
// legacy installs. As of v1.7.4 the setup wizard calls this directly when
// the user clicks Finish, so the box CachePanel is installed on shows up
// in the server picker without manual Add-Server clicks.
let primaryEnsured = false;
export async function ensurePrimaryServer(): Promise<Server | null> {
  if (primaryEnsured) {
    return prisma.server.findFirst({ where: { isPrimary: true } });
  }
  // Mark eager so concurrent boot requests don't double-create. Cleared if
  // the create fails so the next call retries.
  primaryEnsured = true;

  try {
    const existing = await prisma.server.findFirst({ where: { isPrimary: true } });
    if (existing) return existing;

    // Prefer wizard-saved values, fall back to legacy env vars.
    const sshHost = (await getConfig('ssh_host')) || process.env.SSH_HOST || '';
    const sshUser = (await getConfig('ssh_user')) || process.env.SSH_USER || '';
    const sshPort = (await getConfig('ssh_port')) || parseInt(process.env.SSH_PORT || '22', 10);
    const sshKey = (await getConfig('ssh_key_path')) || process.env.SSH_KEY_PATH || '';
    const sshKnownHosts = process.env.SSH_KNOWN_HOSTS || '';

    if (!sshHost || !sshUser) {
      // No SSH configured at all — no primary to create yet. The Servers admin
      // page can let OWNER create one manually.
      primaryEnsured = false;
      return null;
    }
    const created = await prisma.server.create({
      data: {
        name: 'primary',
        hostname: sshHost,
        port: typeof sshPort === 'number' ? sshPort : 22,
        defaultUser: sshUser,
        keyName: path.basename(sshKey || 'cachepanel_id_ed25519'),
        knownHostsName: path.basename(sshKnownHosts || 'known_hosts'),
        tags: 'primary,local',
        isPrimary: true,
        notes: 'Auto-created from setup wizard / SSH-to-host config.',
      },
    });
    // Drop the usingHost cache so the next request sees the new row
    // immediately instead of waiting out the TTL.
    resetUsingHostCache();
    return created;
  } catch (err) {
    primaryEnsured = false;
    throw err;
  }
}

// Force-refresh: called from /api/setup/complete after the wizard saves
// ssh_host/ssh_user, so the new values take effect without waiting for the
// next module reload.
export function resetPrimaryEnsuredCache(): void {
  primaryEnsured = false;
}

export async function getServerById(id: string | null | undefined): Promise<Server | null> {
  await ensurePrimaryServer();
  if (id) {
    const s = await prisma.server.findUnique({ where: { id } });
    if (s) return s;
  }
  return prisma.server.findFirst({ where: { isPrimary: true } });
}

export async function listServers(): Promise<Server[]> {
  await ensurePrimaryServer();
  return prisma.server.findMany({ orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }] });
}

// Resolve the right SshSpec for a (user, server) pair. If the user has a
// per-server provision row with a username, use that account + their
// per-user key. Otherwise fall back to the server's defaultUser + global key.
export async function resolveSshSpec(
  server: Server,
  userId: string | null,
): Promise<SshSpec> {
  const globalKey = resolveSecretPath(server.keyName);
  const knownHosts = resolveSecretPath(server.knownHostsName);

  if (userId) {
    const provision = await prisma.userServerProvision.findUnique({
      where: { userId_serverId: { userId, serverId: server.id } },
    });
    if (provision && provision.provisioned && provision.sshUsername) {
      const userKey = path.join(PER_USER_SECRETS_DIR, userId, 'id_ed25519');
      if (fs.existsSync(userKey)) {
        return {
          host: server.hostname,
          port: server.port,
          user: provision.sshUsername,
          keyPath: userKey,
          knownHosts,
        };
      }
    }
  }

  return {
    host: server.hostname,
    port: server.port,
    user: server.defaultUser,
    keyPath: globalKey,
    knownHosts,
  };
}

// Build the standard ssh argv from a SshSpec.
export function sshArgs(spec: SshSpec, extra: string[] = []): string[] {
  return [
    '-i', spec.keyPath,
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=4',
    '-o', 'StrictHostKeyChecking=yes',
    '-o', `UserKnownHostsFile=${spec.knownHosts}`,
    '-p', String(spec.port),
    ...extra,
    `${spec.user}@${spec.host}`,
  ];
}

export function tagsToList(tags: string): string[] {
  return tags
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}
