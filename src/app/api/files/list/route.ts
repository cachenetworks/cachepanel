import { NextResponse } from 'next/server';
import path from 'node:path';
import { authorize } from '@/lib/api-auth';
import { FsGuardError, getAllowedRoots, resolveSafePath } from '@/lib/fs-guard';
import { hostListDir, hostStat, usingHost } from '@/lib/host-fs';
import { getRequestServerId } from '@/lib/req-server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const auth = await authorize();
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const requested = url.searchParams.get('path') ?? '';
  const serverId = getRequestServerId(req);
  const opts = { serverId, userId: auth.user.id };

  // Empty path → show shortcut roots. When unrestricted, surface common dirs.
  if (!requested) {
    const roots = getAllowedRoots();
    const isUnrestricted = roots.length === 1 && roots[0] === '/';
    const shortcutSet = isUnrestricted
      ? ['/', '/home', '/root', '/etc', '/var', '/var/log', '/var/www', '/srv', '/opt', '/usr/local', '/tmp']
      : roots;
    const items = await Promise.all(
      shortcutSet.map(async (r) => {
        const s = await hostStat(r, opts);
        if (!s) return null;
        return {
          name: r,
          path: r,
          type: 'directory' as const,
          size: 0,
          modifiedAt: s.modifiedAt,
          isRoot: true,
        };
      }),
    );
    return NextResponse.json({
      cwd: '',
      isVirtualRoot: true,
      items: items.filter(Boolean),
      roots,
      unrestricted: isUnrestricted,
      source: usingHost() ? 'host-ssh' : 'container',
    });
  }

  try {
    const resolved = resolveSafePath(requested, { isOwner: auth.user.role === 'OWNER' });
    // "/" always exists on Linux; skip the stat to avoid quirky SSH parsing.
    const isFsRoot = resolved.absolute === '/' || resolved.absolute === '\\';
    const stat = isFsRoot ? { type: 'directory' as const, size: 0, modifiedAt: null } : await hostStat(resolved.absolute, opts);
    if (!stat) {
      console.warn('[files/list] hostStat returned null for', resolved.absolute);
      return NextResponse.json({ error: 'Path not found', path: resolved.absolute }, { status: 404 });
    }
    if (stat.type !== 'directory') {
      console.warn('[files/list] not a directory:', resolved.absolute, 'type=', stat.type);
      return NextResponse.json({ error: 'Path is not a directory', path: resolved.absolute, type: stat.type }, { status: 400 });
    }
    const entries = await hostListDir(resolved.absolute, opts);
    if (entries === null) {
      return NextResponse.json({ error: 'Failed to list directory (permission denied?)' }, { status: 500 });
    }
    const cwdPosix = resolved.absolute.replace(/\\/g, '/');
    const items = entries.map((e) => ({
      name: e.name,
      path: path.posix.join(cwdPosix, e.name),
      type: e.type,
      size: e.size,
      modifiedAt: e.modifiedAt,
      isSensitive:
        e.name.startsWith('.env') ||
        e.name.endsWith('.pem') ||
        e.name.endsWith('.key') ||
        e.name === 'id_rsa' ||
        e.name === 'authorized_keys',
    }));
    items.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return NextResponse.json({
      cwd: resolved.absolute,
      parent: resolved.absolute === resolved.root ? '' : path.posix.dirname(cwdPosix),
      root: resolved.root,
      items,
      roots: getAllowedRoots(),
      source: usingHost() ? 'host-ssh' : 'container',
    });
  } catch (err) {
    if (err instanceof FsGuardError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[files/list] error', err);
    return NextResponse.json({ error: 'Failed to list directory' }, { status: 500 });
  }
}
