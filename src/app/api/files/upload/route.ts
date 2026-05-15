import { NextResponse } from 'next/server';
import path from 'node:path';
import { authorize } from '@/lib/api-auth';
import { FsGuardError, resolveSafePath } from '@/lib/fs-guard';
import { audit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { getClientIp } from '@/lib/ip';
import { hostStat, hostUploadBuffer } from '@/lib/host-fs';
import { getRequestServerId } from '@/lib/req-server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_BYTES = 200 * 1024 * 1024;

export async function POST(req: Request) {
  const auth = await authorize();
  if (!auth.ok) return auth.response;

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });

  const dest = form.get('path');
  if (typeof dest !== 'string' || !dest) {
    return NextResponse.json({ error: 'Missing destination path' }, { status: 400 });
  }
  const file = form.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'Missing file' }, { status: 400 });
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'File exceeds upload limit (200 MB).' }, { status: 413 });
  }

  try {
    const destDir = resolveSafePath(dest, { isOwner: auth.user.role === 'OWNER' });
    const opts = { serverId: getRequestServerId(req), userId: auth.user.id };
    const stat = await hostStat(destDir.absolute, opts);
    if (!stat || stat.type !== 'directory') {
      return NextResponse.json({ error: 'Destination is not a directory' }, { status: 400 });
    }
    const safeName = path.basename(file.name).replace(/[/\\]/g, '_');
    const targetPath = path.posix.join(destDir.absolute.replace(/\\/g, '/'), safeName);
    const target = resolveSafePath(targetPath, { isOwner: auth.user.role === 'OWNER' });
    if (await hostStat(target.absolute, opts)) {
      return NextResponse.json({ error: 'A file with that name already exists.' }, { status: 409 });
    }
    const buf = Buffer.from(await file.arrayBuffer());
    const ok = await hostUploadBuffer(target.absolute, buf, opts);
    if (!ok) return NextResponse.json({ error: 'Upload failed (permission denied?)' }, { status: 500 });

    await prisma.fileAction.create({
      data: { userId: auth.user.id, action: 'upload', path: target.absolute },
    });
    await audit({
      userId: auth.user.id,
      action: 'file.uploaded',
      target: target.absolute,
      metadata: { size: file.size },
      ipAddress: getClientIp(req),
    });
    return NextResponse.json({ ok: true, path: target.absolute });
  } catch (err) {
    if (err instanceof FsGuardError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[files/upload] error', err);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
