import { NextResponse } from 'next/server';
import { authorize } from '@/lib/api-auth';
import { FsGuardError, resolveSafePathWithDocker } from '@/lib/fs-guard';
import { runOnHost } from '@/lib/host-probe';
import { getRequestServerId } from '@/lib/req-server';

// Tail-since-offset endpoint. Client polls every ~2s, sending the previous
// `offset` (file size) it observed. We return everything from that offset
// to current EOF, plus the new total size for the next poll.
//
// If the file shrank (rotated/truncated) we re-deliver from byte 0 and
// signal `truncated: true` so the client can flag it.

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_CHUNK_BYTES = 256 * 1024; // 256 KiB per poll — protects against bursty writes flooding the panel.

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export async function GET(req: Request) {
  const auth = await authorize();
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const requested = url.searchParams.get('path') ?? '';
  const offset = Math.max(0, Number.parseInt(url.searchParams.get('offset') ?? '0', 10) || 0);
  if (!requested) return NextResponse.json({ error: 'Missing path' }, { status: 400 });

  const opts = { serverId: getRequestServerId(req), userId: auth.user.id };
  try {
    const resolved = await resolveSafePathWithDocker(requested, { isOwner: auth.user.role === 'OWNER' });

    // Get current size + read tail in one round trip. `stat -c%s` is the
    // GNU coreutils flag; BusyBox stat uses different flags but on Alpine
    // `stat -c` is provided when coreutils is present (it is in our yolk
    // base, and Alpine users typically install coreutils anyway).
    // Fall back to `wc -c` which is universal.
    const sizeRes = await runOnHost(
      `stat -c%s ${shellQuote(resolved.absolute)} 2>/dev/null || wc -c < ${shellQuote(resolved.absolute)}`,
      opts,
    );
    if (sizeRes.code !== 0) {
      return NextResponse.json({ error: 'File not readable' }, { status: 404 });
    }
    const size = parseInt(sizeRes.stdout.trim(), 10);
    if (!Number.isFinite(size)) {
      return NextResponse.json({ error: 'Could not stat file' }, { status: 500 });
    }

    let truncated = false;
    let startAt = offset;
    if (offset > size) {
      // File rotated/truncated.
      truncated = true;
      startAt = Math.max(0, size - MAX_CHUNK_BYTES);
    }

    const bytesToRead = Math.min(MAX_CHUNK_BYTES, size - startAt);
    if (bytesToRead <= 0) {
      return NextResponse.json({ size, content: '', truncated });
    }

    // `tail -c +N` is 1-indexed (byte 1 = first byte). Convert.
    const cmd = `tail -c +${startAt + 1} ${shellQuote(resolved.absolute)} | head -c ${bytesToRead}`;
    const data = await runOnHost(cmd, opts);
    if (data.code !== 0) {
      return NextResponse.json({ error: 'Read failed' }, { status: 500 });
    }
    return NextResponse.json({
      size,
      offset: startAt + Buffer.byteLength(data.stdout),
      content: data.stdout,
      truncated,
    });
  } catch (err) {
    if (err instanceof FsGuardError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[files/tail] error', err);
    return NextResponse.json({ error: 'Tail failed' }, { status: 500 });
  }
}
