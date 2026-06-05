// Filesystem operations that transparently route to the right place:
//   - A managed remote host (Linux via POSIX shell OR Windows via PowerShell),
//   - …or the panel's local container filesystem when no Server is configured.
//
// Multi-server aware: pass { serverId, userId } in opts to target a specific
// managed host. With no opts, falls back to the primary server.
//
// As of v1.8.0 every "host" code path goes through `getAdapter(server)`
// (from host-adapter.ts) so the rest of the codebase doesn't need to know
// whether the target runs Linux or Windows.

import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma } from './prisma';
import { getServerById } from './servers';
import { getAdapter } from './host-adapter';

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

export interface HostOpts {
  serverId?: string | null;
  userId?: string | null;
}

// 3-second cache so we don't slam SQLite on every list call.
let _hostCache: { value: boolean; until: number } | null = null;
const HOST_CACHE_MS = 3_000;

/**
 * Returns true iff there's at least one Server row, i.e. the panel has at
 * least one host it can SSH into. DB-aware (v1.7.6 fix); falls back to the
 * env check only when the DB is unreachable so legacy installs with
 * SSH_HOST set still route to SSH if they had it.
 */
export async function usingHost(): Promise<boolean> {
  const now = Date.now();
  if (_hostCache && _hostCache.until > now) return _hostCache.value;
  let value = false;
  try {
    const count = await prisma.server.count();
    value = count > 0;
  } catch {
    value = !!(process.env.SSH_HOST && process.env.SSH_USER);
  }
  _hostCache = { value, until: now + HOST_CACHE_MS };
  return value;
}

export function resetUsingHostCache(): void {
  _hostCache = null;
}

// Internal: resolve the right adapter for a given (server, user) pair. Returns
// null when no managed server exists yet, signalling the caller to fall back
// to local-container fs.
async function adapterFor(opts: HostOpts) {
  const server = await getServerById(opts.serverId);
  if (!server) return null;
  return getAdapter(server);
}

export async function hostListDir(absPath: string, opts: HostOpts = {}): Promise<HostEntry[] | null> {
  if (await usingHost()) {
    const ad = await adapterFor(opts);
    if (ad) return ad.listDir(absPath, { userId: opts.userId ?? null });
  }
  try {
    const entries = await fs.readdir(absPath, { withFileTypes: true });
    return Promise.all(
      entries.map(async (e) => {
        const s = await fs.stat(path.join(absPath, e.name)).catch(() => null);
        return {
          name: e.name,
          type: e.isDirectory() ? 'directory' : e.isSymbolicLink() ? 'symlink' : 'file',
          size: s?.size ?? 0,
          modifiedAt: s?.mtime?.toISOString() ?? null,
        } satisfies HostEntry;
      }),
    );
  } catch {
    return null;
  }
}

export async function hostStat(absPath: string, opts: HostOpts = {}): Promise<HostStat | null> {
  if (await usingHost()) {
    const ad = await adapterFor(opts);
    if (ad) return ad.stat(absPath, { userId: opts.userId ?? null });
  }
  try {
    const s = await fs.stat(absPath);
    return {
      type: s.isDirectory() ? 'directory' : s.isSymbolicLink() ? 'symlink' : 'file',
      size: s.size,
      modifiedAt: s.mtime.toISOString(),
    };
  } catch {
    return null;
  }
}

export async function hostReadText(absPath: string, maxBytes: number, opts: HostOpts = {}): Promise<string | null> {
  if (await usingHost()) {
    const ad = await adapterFor(opts);
    if (ad) return ad.readText(absPath, maxBytes, { userId: opts.userId ?? null });
  }
  try {
    return await fs.readFile(absPath, 'utf-8');
  } catch {
    return null;
  }
}

export async function hostWriteText(absPath: string, content: string, opts: HostOpts = {}): Promise<boolean> {
  if (await usingHost()) {
    const ad = await adapterFor(opts);
    if (ad) return ad.writeText(absPath, content, { userId: opts.userId ?? null });
  }
  try {
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, content, 'utf-8');
    return true;
  } catch {
    return false;
  }
}

export async function hostDelete(absPath: string, opts: HostOpts = {}): Promise<boolean> {
  if (await usingHost()) {
    const ad = await adapterFor(opts);
    if (ad) return ad.remove(absPath, true, { userId: opts.userId ?? null });
  }
  try {
    const s = await fs.stat(absPath);
    if (s.isDirectory()) await fs.rm(absPath, { recursive: true, force: true });
    else await fs.unlink(absPath);
    return true;
  } catch {
    return false;
  }
}

export async function hostRename(from: string, to: string, opts: HostOpts = {}): Promise<boolean> {
  if (await usingHost()) {
    const ad = await adapterFor(opts);
    if (ad) return ad.move(from, to, { userId: opts.userId ?? null });
  }
  try {
    await fs.rename(from, to);
    return true;
  } catch {
    return false;
  }
}

export async function hostCreate(absPath: string, type: 'file' | 'folder', opts: HostOpts = {}): Promise<boolean> {
  if (await usingHost()) {
    const ad = await adapterFor(opts);
    if (ad) return type === 'folder' ? ad.mkdir(absPath, true, { userId: opts.userId ?? null }) : ad.createFile(absPath, { userId: opts.userId ?? null });
  }
  try {
    if (type === 'folder') await fs.mkdir(absPath, { recursive: true });
    else {
      await fs.mkdir(path.dirname(absPath), { recursive: true });
      await fs.writeFile(absPath, '');
    }
    return true;
  } catch {
    return false;
  }
}

export async function hostUploadBuffer(absPath: string, buf: Buffer, opts: HostOpts = {}): Promise<boolean> {
  if (await usingHost()) {
    const ad = await adapterFor(opts);
    if (ad) return ad.writeBytes(absPath, buf, { userId: opts.userId ?? null });
  }
  try {
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, buf);
    return true;
  } catch {
    return false;
  }
}

export async function hostReadBuffer(absPath: string, maxBytes: number, opts: HostOpts = {}): Promise<Buffer | null> {
  if (await usingHost()) {
    const ad = await adapterFor(opts);
    if (ad) return ad.readBytes(absPath, maxBytes, { userId: opts.userId ?? null });
  }
  try {
    return await fs.readFile(absPath);
  } catch {
    return null;
  }
}
