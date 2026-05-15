import { NextResponse } from 'next/server';
import { authorize } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { audit } from '@/lib/audit';
import { getClientIp } from '@/lib/ip';
import { deleteUserKey, deleteUserOnHost } from '@/lib/per-user-ssh';

export const dynamic = 'force-dynamic';

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const auth = await authorize({ requireOwner: true });
  if (!auth.ok) return auth.response;

  if (params.id === auth.user.id) {
    return NextResponse.json({ error: 'You cannot delete your own account.' }, { status: 400 });
  }
  const target = await prisma.user.findUnique({ where: { id: params.id } });
  if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 });
  if (target.role === 'OWNER') {
    const otherOwners = await prisma.user.count({
      where: { role: 'OWNER', status: 'APPROVED', NOT: { id: target.id } },
    });
    if (otherOwners === 0) {
      return NextResponse.json({ error: 'Cannot delete the only OWNER.' }, { status: 400 });
    }
  }
  // Tear down their host account + key before removing the row.
  if (target.sshUsername) {
    await deleteUserOnHost(target.sshUsername).catch(() => undefined);
  }
  await deleteUserKey(target.id).catch(() => undefined);
  await prisma.user.delete({ where: { id: target.id } });
  await audit({
    userId: auth.user.id,
    action: 'user.deleted',
    target: target.id,
    metadata: { username: target.username },
    ipAddress: getClientIp(req),
  });
  return NextResponse.json({ ok: true });
}
