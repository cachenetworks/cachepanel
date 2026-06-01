import { NextResponse } from 'next/server';
import { authorize } from '@/lib/api-auth';
import { FsGuardError, isLikelyText, resolveSafePathWithDocker } from '@/lib/fs-guard';
import { hostReadText, hostStat } from '@/lib/host-fs';
import { getRequestServerId } from '@/lib/req-server';

const MAX_TEXT_BYTES = 2 * 1024 * 1024;

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const auth = await authorize();
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const requested = url.searchParams.get('path') ?? '';
  if (!requested) return NextResponse.json({ error: 'Missing path' }, { status: 400 });

  const opts = { serverId: getRequestServerId(req), userId: auth.user.id };
  try {
    const resolved = await resolveSafePathWithDocker(requested, { isOwner: auth.user.role === 'OWNER' });
    const stat = await hostStat(resolved.absolute, opts);
    if (!stat) return NextResponse.json({ error: 'File not found' }, { status: 404 });
    if (stat.type !== 'file') return NextResponse.json({ error: 'Not a file' }, { status: 400 });
    const isText = isLikelyText(resolved.absolute);
    if (!isText) {
      return NextResponse.json({
        path: resolved.absolute,
        size: stat.size,
        modifiedAt: stat.modifiedAt,
        binary: true,
        sensitive: resolved.isSensitive,
        content: null,
      });
    }
    if (stat.size > MAX_TEXT_BYTES) {
      return NextResponse.json({
        path: resolved.absolute,
        size: stat.size,
        modifiedAt: stat.modifiedAt,
        binary: false,
        truncated: true,
        sensitive: resolved.isSensitive,
        content: null,
        error: 'File is too large to edit in the browser.',
      });
    }
    const content = await hostReadText(resolved.absolute, MAX_TEXT_BYTES, opts);
    if (content === null) return NextResponse.json({ error: 'Failed to read file' }, { status: 500 });
    return NextResponse.json({
      path: resolved.absolute,
      size: stat.size,
      modifiedAt: stat.modifiedAt,
      binary: false,
      sensitive: resolved.isSensitive,
      content,
    });
  } catch (err) {
    if (err instanceof FsGuardError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[files/read] error', err);
    return NextResponse.json({ error: 'Failed to read file' }, { status: 500 });
  }
}
