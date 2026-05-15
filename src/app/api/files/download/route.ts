import { NextResponse } from 'next/server';
import path from 'node:path';
import { authorize } from '@/lib/api-auth';
import { FsGuardError, resolveSafePath } from '@/lib/fs-guard';
import { hostReadBuffer, hostStat } from '@/lib/host-fs';
import { getRequestServerId } from '@/lib/req-server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_BYTES = 500 * 1024 * 1024;

export async function GET(req: Request) {
  const auth = await authorize();
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const requested = url.searchParams.get('path') ?? '';
  if (!requested) return NextResponse.json({ error: 'Missing path' }, { status: 400 });

  try {
    const resolved = resolveSafePath(requested, { isOwner: auth.user.role === 'OWNER' });
    const opts = { serverId: getRequestServerId(req), userId: auth.user.id };
    const stat = await hostStat(resolved.absolute, opts);
    if (!stat) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (stat.type !== 'file') return NextResponse.json({ error: 'Not a file' }, { status: 400 });
    if (stat.size > MAX_BYTES) {
      return NextResponse.json({ error: 'File exceeds the 500 MB download limit.' }, { status: 413 });
    }

    const buf = await hostReadBuffer(resolved.absolute, MAX_BYTES, opts);
    if (!buf) return NextResponse.json({ error: 'Download failed' }, { status: 500 });

    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(buf.length),
        'Content-Disposition': `attachment; filename="${path.basename(resolved.absolute).replace(/"/g, '')}"`,
      },
    });
  } catch (err) {
    if (err instanceof FsGuardError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[files/download] error', err);
    return NextResponse.json({ error: 'Download failed' }, { status: 500 });
  }
}
