import { NextResponse } from 'next/server';
import { authorize } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { audit } from '@/lib/audit';
import { emitAlert } from '@/lib/alerts';

export const dynamic = 'force-dynamic';

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const auth = await authorize();
  if (!auth.ok) return auth.response;

  const target = await prisma.authenticator.findUnique({ where: { id: params.id } });
  if (!target || target.userId !== auth.user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  await prisma.authenticator.delete({ where: { id: target.id } });

  // If that was the last key, also clear recovery codes — they'd be orphaned.
  const remaining = await prisma.authenticator.count({ where: { userId: auth.user.id } });
  if (remaining === 0) {
    await prisma.recoveryCode.deleteMany({ where: { userId: auth.user.id } });
  }

  await audit({
    userId: auth.user.id,
    action: 'settings.changed',
    target: 'mfa.removed',
    metadata: { nickname: target.nickname, remaining },
  });
  void emitAlert('mfa.removed', {
    description: `**${auth.user.username}** removed a security key (${target.nickname}). ${remaining} remaining.`,
  });

  return NextResponse.json({ ok: true, remaining });
}
