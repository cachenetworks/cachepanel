import { NextResponse } from 'next/server';
import { authorize } from '@/lib/api-auth';
import { FsGuardError, isLikelyText, resolveSafePathWithDocker } from '@/lib/fs-guard';
import { audit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { getClientIp } from '@/lib/ip';
import { fileWriteSchema } from '@/lib/validation';
import { hostWriteText } from '@/lib/host-fs';
import { getRequestServerId } from '@/lib/req-server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const auth = await authorize();
  if (!auth.ok) return auth.response;

  const raw = await req.json().catch(() => null);
  const parsed = fileWriteSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });

  try {
    const resolved = await resolveSafePathWithDocker(parsed.data.path, { isOwner: auth.user.role === 'OWNER' });
    if (!isLikelyText(resolved.absolute)) {
      return NextResponse.json({ error: 'Refusing to overwrite a non-text file.' }, { status: 400 });
    }
    const ok = await hostWriteText(resolved.absolute, parsed.data.content, {
      serverId: getRequestServerId(req),
      userId: auth.user.id,
    });
    if (!ok) return NextResponse.json({ error: 'Failed to write file (permission denied?)' }, { status: 500 });
    await prisma.fileAction.create({
      data: { userId: auth.user.id, action: 'edit', path: resolved.absolute },
    });
    await audit({
      userId: auth.user.id,
      action: 'file.edited',
      target: resolved.absolute,
      metadata: { bytes: parsed.data.content.length },
      ipAddress: getClientIp(req),
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof FsGuardError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[files/write] error', err);
    return NextResponse.json({ error: 'Failed to write file' }, { status: 500 });
  }
}
