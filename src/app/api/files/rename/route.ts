import { NextResponse } from 'next/server';
import { authorize } from '@/lib/api-auth';
import { FsGuardError, resolveSafePath } from '@/lib/fs-guard';
import { audit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { getClientIp } from '@/lib/ip';
import { fileRenameSchema } from '@/lib/validation';
import { hostRename, hostStat } from '@/lib/host-fs';
import { getRequestServerId } from '@/lib/req-server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const auth = await authorize();
  if (!auth.ok) return auth.response;

  const raw = await req.json().catch(() => null);
  const parsed = fileRenameSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });

  try {
    const isOwner = auth.user.role === 'OWNER';
    const from = resolveSafePath(parsed.data.from, { isOwner });
    const to = resolveSafePath(parsed.data.to, { isOwner });
    const opts = { serverId: getRequestServerId(req), userId: auth.user.id };
    const fromStat = await hostStat(from.absolute, opts);
    if (!fromStat) return NextResponse.json({ error: 'Source not found' }, { status: 404 });
    if (await hostStat(to.absolute, opts)) {
      return NextResponse.json({ error: 'Destination already exists' }, { status: 409 });
    }
    const ok = await hostRename(from.absolute, to.absolute, opts);
    if (!ok) return NextResponse.json({ error: 'Failed to rename (permission denied?)' }, { status: 500 });
    await prisma.fileAction.create({
      data: { userId: auth.user.id, action: 'rename', path: `${from.absolute} -> ${to.absolute}` },
    });
    await audit({
      userId: auth.user.id,
      action: 'file.renamed',
      target: to.absolute,
      metadata: { from: from.absolute },
      ipAddress: getClientIp(req),
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof FsGuardError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[files/rename] error', err);
    return NextResponse.json({ error: 'Failed to rename' }, { status: 500 });
  }
}
