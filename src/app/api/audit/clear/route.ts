import { NextResponse } from 'next/server';
import { authorize } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { audit } from '@/lib/audit';
import { getClientIp } from '@/lib/ip';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const auth = await authorize({ requireOwner: true });
  if (!auth.ok) return auth.response;
  const result = await prisma.auditLog.deleteMany({});
  await audit({
    userId: auth.user.id,
    action: 'settings.changed',
    target: 'audit.cleared',
    metadata: { deleted: result.count },
    ipAddress: getClientIp(req),
  });
  return NextResponse.json({ ok: true, deleted: result.count });
}
