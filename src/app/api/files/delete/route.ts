import { NextResponse } from 'next/server';
import { authorize } from '@/lib/api-auth';
import { FsGuardError, getAllowedRoots, resolveSafePathWithDocker } from '@/lib/fs-guard';
import { audit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { getClientIp } from '@/lib/ip';
import { pathSchema } from '@/lib/validation';
import { hostDelete, hostStat } from '@/lib/host-fs';
import { getRequestServerId } from '@/lib/req-server';
import { z } from 'zod';

const schema = z.object({ path: pathSchema });

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const auth = await authorize();
  if (!auth.ok) return auth.response;

  const raw = await req.json().catch(() => null);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });

  try {
    const resolved = await resolveSafePathWithDocker(parsed.data.path, { isOwner: auth.user.role === 'OWNER' });
    if (getAllowedRoots().includes(resolved.absolute) || resolved.absolute === '/') {
      return NextResponse.json({ error: 'Refusing to delete a filesystem root.' }, { status: 400 });
    }
    const opts = { serverId: getRequestServerId(req), userId: auth.user.id };
    const stat = await hostStat(resolved.absolute, opts);
    if (!stat) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const ok = await hostDelete(resolved.absolute, opts);
    if (!ok) return NextResponse.json({ error: 'Failed to delete (permission denied?)' }, { status: 500 });
    await prisma.fileAction.create({
      data: { userId: auth.user.id, action: 'delete', path: resolved.absolute },
    });
    await audit({
      userId: auth.user.id,
      action: 'file.deleted',
      target: resolved.absolute,
      ipAddress: getClientIp(req),
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof FsGuardError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[files/delete] error', err);
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
