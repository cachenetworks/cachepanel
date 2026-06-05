import { NextResponse } from 'next/server';
import { authorize } from '@/lib/api-auth';
import { FsGuardError, resolveSafePathWithDocker } from '@/lib/fs-guard';
import { runOnHost } from '@/lib/host-probe';
import { getServerById } from '@/lib/servers';
import { getAdapter } from '@/lib/host-adapter';
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

function psQuote(s: string): string {
  return `'${s.replace(/'/g, `''`)}'`;
}

export async function GET(req: Request) {
  const auth = await authorize();
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const requested = url.searchParams.get('path') ?? '';
  const offset = Math.max(0, Number.parseInt(url.searchParams.get('offset') ?? '0', 10) || 0);
  if (!requested) return NextResponse.json({ error: 'Missing path' }, { status: 400 });

  const serverId = getRequestServerId(req);
  const opts = { serverId, userId: auth.user.id };

  try {
    const resolved = await resolveSafePathWithDocker(requested, { isOwner: auth.user.role === 'OWNER' });

    // OS-aware: Windows hosts can't run `stat -c%s | tail -c +N | head -c N`,
    // so fork on the server's recorded OS. Path resolution stays the same
    // (an absolute path on the host is an absolute path).
    const server = await getServerById(serverId);
    const isWindows = (server?.os ?? 'linux') === 'windows';

    if (isWindows) {
      return tailWindows(resolved.absolute, offset, opts);
    }
    return tailPosix(resolved.absolute, offset, opts);
  } catch (err) {
    if (err instanceof FsGuardError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[files/tail] error', err);
    return NextResponse.json({ error: 'Tail failed' }, { status: 500 });
  }
}

async function tailPosix(absPath: string, offset: number, opts: { serverId: string | null; userId: string }) {
  // Get current size + read tail in one round trip. `stat -c%s` is the
  // GNU coreutils flag; BusyBox stat uses different flags but on Alpine
  // `stat -c` is provided when coreutils is present (it is in our yolk
  // base, and Alpine users typically install coreutils anyway).
  // Fall back to `wc -c` which is universal.
  const sizeRes = await runOnHost(
    `stat -c%s ${shellQuote(absPath)} 2>/dev/null || wc -c < ${shellQuote(absPath)}`,
    opts,
  );
  if (sizeRes.code !== 0) return NextResponse.json({ error: 'File not readable' }, { status: 404 });
  const size = parseInt(sizeRes.stdout.trim(), 10);
  if (!Number.isFinite(size)) return NextResponse.json({ error: 'Could not stat file' }, { status: 500 });

  let truncated = false;
  let startAt = offset;
  if (offset > size) {
    truncated = true;
    startAt = Math.max(0, size - MAX_CHUNK_BYTES);
  }

  const bytesToRead = Math.min(MAX_CHUNK_BYTES, size - startAt);
  if (bytesToRead <= 0) return NextResponse.json({ size, content: '', truncated });

  // `tail -c +N` is 1-indexed (byte 1 = first byte). Convert.
  const cmd = `tail -c +${startAt + 1} ${shellQuote(absPath)} | head -c ${bytesToRead}`;
  const data = await runOnHost(cmd, opts);
  if (data.code !== 0) return NextResponse.json({ error: 'Read failed' }, { status: 500 });
  return NextResponse.json({
    size,
    offset: startAt + Buffer.byteLength(data.stdout),
    content: data.stdout,
    truncated,
  });
}

async function tailWindows(absPath: string, offset: number, opts: { serverId: string | null; userId: string }) {
  // Windows equivalent: open the file, seek to offset, read up to
  // MAX_CHUNK_BYTES. Emit a small JSON envelope so we don't have to parse
  // two unrelated lines back from one stdout.
  const server = await getServerById(opts.serverId);
  if (!server) return NextResponse.json({ error: 'No server configured' }, { status: 500 });
  const adapter = await getAdapter(server);
  const script = `
$p = ${psQuote(absPath)}
$fi = Get-Item -LiteralPath $p
$size = $fi.Length
$offset = ${offset}
$max = ${MAX_CHUNK_BYTES}
$truncated = $false
$startAt = $offset
if ($offset -gt $size) {
  $truncated = $true
  $startAt = [Math]::Max(0, $size - $max)
}
$bytesToRead = [Math]::Min($max, $size - $startAt)
$content = ''
if ($bytesToRead -gt 0) {
  $fs = [IO.File]::OpenRead($p)
  try {
    $fs.Seek($startAt, [IO.SeekOrigin]::Begin) | Out-Null
    $buf = New-Object byte[] $bytesToRead
    $read = $fs.Read($buf, 0, $bytesToRead)
    if ($read -gt 0) {
      $content = [Convert]::ToBase64String($buf, 0, $read)
    }
  } finally { $fs.Close() }
}
[pscustomobject]@{
  size = $size
  content_b64 = $content
  truncated = $truncated
  offset = $startAt + [int]([Math]::Floor($bytesToRead))
} | ConvertTo-Json -Compress`;
  const r = await adapter.runScript(script, { userId: opts.userId, timeoutMs: 10_000 });
  if (r.code !== 0) {
    return NextResponse.json({ error: 'Tail failed', stderr: r.stderr }, { status: 500 });
  }
  try {
    const j = JSON.parse(r.stdout.trim()) as {
      size: number; content_b64: string; truncated: boolean; offset: number;
    };
    const content = j.content_b64 ? Buffer.from(j.content_b64, 'base64').toString('utf-8') : '';
    return NextResponse.json({
      size: j.size,
      offset: j.offset,
      content,
      truncated: j.truncated,
    });
  } catch {
    return NextResponse.json({ error: 'Could not parse tail response' }, { status: 500 });
  }
}
