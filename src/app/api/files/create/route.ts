import { NextResponse } from 'next/server';
import { authorize } from '@/lib/api-auth';
import { FsGuardError, resolveSafePath } from '@/lib/fs-guard';
import { audit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { getClientIp } from '@/lib/ip';
import { fileCreateSchema } from '@/lib/validation';
import { hostCreate, hostStat } from '@/lib/host-fs';
import { getRequestServerId } from '@/lib/req-server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const auth = await authorize();
  if (!auth.ok) return auth.response;

  const raw = await req.json().catch(() => null);
  const parsed = fileCreateSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });

  const opts = { serverId: getRequestServerId(req), userId: auth.user.id };
  try {
    const resolved = resolveSafePath(parsed.data.path, { isOwner: auth.user.role === 'OWNER' });
    if (await hostStat(resolved.absolute, opts)) {
      return NextResponse.json({ error: 'Path already exists' }, { status: 409 });
    }
    const ok = await hostCreate(resolved.absolute, parsed.data.type, opts);
    if (!ok) return NextResponse.json({ error: 'Failed to create (permission denied?)' }, { status: 500 });
    await prisma.fileAction.create({
      data: { userId: auth.user.id, action: `create.${parsed.data.type}`, path: resolved.absolute },
    });
    await audit({
      userId: auth.user.id,
      action: 'file.created',
      target: resolved.absolute,
      metadata: { type: parsed.data.type },
      ipAddress: getClientIp(req),
    });
    return NextResponse.json({ ok: true, path: resolved.absolute });
  } catch (err) {
    if (err instanceof FsGuardError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[files/create] error', err);
    return NextResponse.json({ error: 'Failed to create' }, { status: 500 });
  }
}
