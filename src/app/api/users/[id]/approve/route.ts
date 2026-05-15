import { NextResponse } from 'next/server';
import { authorize } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { audit } from '@/lib/audit';
import { adminCanApproveUsers } from '@/lib/settings';
import { getClientIp } from '@/lib/ip';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await authorize();
  if (!auth.ok) return auth.response;

  if (auth.user.role !== 'OWNER') {
    const allowed = await adminCanApproveUsers();
    if (!allowed) {
      return NextResponse.json({ error: 'Only OWNER can approve users.' }, { status: 403 });
    }
  }

  const target = await prisma.user.findUnique({ where: { id: params.id } });
  if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 });
  if (target.status === 'APPROVED') {
    return NextResponse.json({ error: 'User is already approved' }, { status: 400 });
  }
  if (target.role === 'OWNER' && auth.user.role !== 'OWNER') {
    return NextResponse.json({ error: 'Only OWNER can approve OWNER accounts.' }, { status: 403 });
  }

  const updated = await prisma.user.update({
    where: { id: target.id },
    data: { status: 'APPROVED', role: target.role === 'OWNER' ? 'OWNER' : 'ADMIN' },
  });

  await audit({
    userId: auth.user.id,
    action: 'user.approved',
    target: target.id,
    metadata: { username: target.username, by: auth.user.username },
    ipAddress: getClientIp(req),
  });

  return NextResponse.json({ user: updated });
}
