import { NextResponse } from 'next/server';
import { authorize } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { audit } from '@/lib/audit';
import { getClientIp } from '@/lib/ip';
import { disableUserOnHost } from '@/lib/per-user-ssh';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await authorize({ requireOwner: true });
  if (!auth.ok) return auth.response;

  if (params.id === auth.user.id) {
    return NextResponse.json({ error: 'You cannot disable your own account.' }, { status: 400 });
  }

  const target = await prisma.user.findUnique({ where: { id: params.id } });
  if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  if (target.role === 'OWNER') {
    const otherOwners = await prisma.user.count({
      where: { role: 'OWNER', status: 'APPROVED', NOT: { id: target.id } },
    });
    if (otherOwners === 0) {
      return NextResponse.json(
        { error: 'Cannot disable the only OWNER. Promote another OWNER first.' },
        { status: 400 },
      );
    }
  }

  // If the user had per-user SSH provisioned, lock the host account too.
  if (target.sshAccess && target.sshUsername) {
    await disableUserOnHost(target.sshUsername).catch(() => undefined);
  }

  const updated = await prisma.user.update({
    where: { id: target.id },
    data: { status: 'DISABLED', sshAccess: false },
  });

  await audit({
    userId: auth.user.id,
    action: 'user.disabled',
    target: target.id,
    metadata: { username: target.username, by: auth.user.username },
    ipAddress: getClientIp(req),
  });

  return NextResponse.json({ user: updated });
}
