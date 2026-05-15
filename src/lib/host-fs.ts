// Filesystem operations that transparently run on the SSH host. Multi-server
// aware: pass { serverId, userId } in opts to target a specific managed host.
// With no opts, falls back to the primary server.

import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { runOnHost } from './host-probe';
import { getServerById, resolveSshSpec, sshArgs } from './servers';

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

export function usingHost(): boolean {
  // We have a primary server iff SSH_HOST is configured (auto-imported).
  // Multi-server installs can also have manually-added rows, so this is a
  // conservative "yes there's at least one host" check.
  return !!(process.env.SSH_HOST && process.env.SSH_USER);
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export async function hostListDir(absPath: string, opts: HostOpts = {}): Promise<HostEntry[] | null> {
  if (usingHost()) {
    const cmd =
      `cd ${shellQuote(absPath)} 2>/dev/null && ` +
      `LC_ALL=C find . -mindepth 1 -maxdepth 1 -printf '%y|||%s|||%T@|||%f\\0' 2>/dev/null`;
    const r = await runOnHost(cmd, { ...opts, timeoutMs: 8000 });
    if (r.code !== 0 && !r.stdout) return null;
    const out: HostEntry[] = [];
    for (const rec of r.stdout.split('\0')) {
      if (!rec) continue;
      const [kind, sizeStr, mtimeStr, name] = rec.split('|||');
      if (!name) continue;
      let type: HostEntry['type'] = 'file';
      if (kind === 'd') type = 'directory';
      else if (kind === 'l') type = 'symlink';
      const mtime = parseFloat(mtimeStr ?? '');
      out.push({
        name,
        type,
        size: parseInt(sizeStr ?? '0', 10) || 0,
        modifiedAt: Number.isFinite(mtime) ? new Date(mtime * 1000).toISOString() : null,
      });
    }
    return out;
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
  if (usingHost()) {
    const r = await runOnHost(`stat -c '%F|||%s|||%Y' ${shellQuote(absPath)} 2>/dev/null`, opts);
    if (r.code !== 0 || !r.stdout.trim()) return null;
    const [kind, sizeStr, mtimeStr] = r.stdout.trim().split('|||');
    const type: HostStat['type'] =
      kind === 'directory' ? 'directory' : kind === 'symbolic link' ? 'symlink' : 'file';
    const mtime = parseInt(mtimeStr ?? '', 10);
    return {
      type,
      size: parseInt(sizeStr ?? '0', 10) || 0,
      modifiedAt: Number.isFinite(mtime) ? new Date(mtime * 1000).toISOString() : null,
    };
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
  if (usingHost()) {
    const r = await runOnHost(
      `head -c ${maxBytes + 1} ${shellQuote(absPath)} 2>/dev/null | base64 -w0`,
      { ...opts, timeoutMs: 10_000 },
    );
    if (r.code !== 0) return null;
    const buf = Buffer.from(r.stdout.trim(), 'base64');
    if (buf.length > maxBytes) return null;
    return buf.toString('utf-8');
  }
  try {
    return await fs.readFile(absPath, 'utf-8');
  } catch {
    return null;
  }
}

export async function hostWriteText(absPath: string, content: string, opts: HostOpts = {}): Promise<boolean> {
  if (usingHost()) {
    const b64 = Buffer.from(content, 'utf-8').toString('base64');
    const cmd = `mkdir -p ${shellQuote(path.dirname(absPath))} && base64 -d > ${shellQuote(absPath)}`;
    const r = await runOnHostStdin(cmd, b64, opts);
    return r.code === 0;
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
  if (usingHost()) {
    const r = await runOnHost(`rm -rf ${shellQuote(absPath)}`, { ...opts, timeoutMs: 15_000 });
    return r.code === 0;
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
  if (usingHost()) {
    const r = await runOnHost(`mv ${shellQuote(from)} ${shellQuote(to)}`, { ...opts, timeoutMs: 8000 });
    return r.code === 0;
  }
  try {
    await fs.rename(from, to);
    return true;
  } catch {
    return false;
  }
}

export async function hostCreate(absPath: string, type: 'file' | 'folder', opts: HostOpts = {}): Promise<boolean> {
  if (usingHost()) {
    const cmd =
      type === 'folder'
        ? `mkdir -p ${shellQuote(absPath)}`
        : `mkdir -p ${shellQuote(path.dirname(absPath))} && touch ${shellQuote(absPath)}`;
    const r = await runOnHost(cmd, opts);
    return r.code === 0;
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
  if (usingHost()) {
    const b64 = buf.toString('base64');
    const cmd = `mkdir -p ${shellQuote(path.dirname(absPath))} && base64 -d > ${shellQuote(absPath)}`;
    const r = await runOnHostStdin(cmd, b64, opts);
    return r.code === 0;
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
  if (usingHost()) {
    const r = await runOnHost(
      `head -c ${maxBytes + 1} ${shellQuote(absPath)} 2>/dev/null | base64 -w0`,
      { ...opts, timeoutMs: 60_000 },
    );
    if (r.code !== 0) return null;
    const buf = Buffer.from(r.stdout.trim(), 'base64');
    if (buf.length > maxBytes) return null;
    return buf;
  }
  try {
    return await fs.readFile(absPath);
  } catch {
    return null;
  }
}

// Helper: pipe stdin into an ssh exec — used for writes.
async function runOnHostStdin(
  command: string,
  stdin: string,
  opts: HostOpts = {},
  timeoutMs = 60_000,
): Promise<{ stdout: string; stderr: string; code: number }> {
  const server = await getServerById(opts.serverId);
  if (!server) return { stdout: '', stderr: 'No server configured', code: -1 };
  const spec = await resolveSshSpec(server, opts.userId ?? null);
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
