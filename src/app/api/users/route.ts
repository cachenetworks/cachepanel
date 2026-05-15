import { NextResponse } from 'next/server';
import { authorize } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { getPresenceMap } from '@/lib/presence';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await authorize();
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const q = url.searchParams.get('q')?.trim() ?? '';
  const role = url.searchParams.get('role') ?? '';
  const status = url.searchParams.get('status') ?? '';

  const where: Record<string, unknown> = {};
  if (q) {
    where.OR = [
      { username: { contains: q, mode: 'insensitive' } },
      { discordId: { contains: q } },
      { email: { contains: q, mode: 'insensitive' } },
    ];
  }
  if (role === 'OWNER' || role === 'ADMIN') where.role = role;
  if (status === 'PENDING' || status === 'APPROVED' || status === 'DISABLED') where.status = status;

  const users = await prisma.user.findMany({
    where,
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      discordId: true,
      username: true,
      avatar: true,
      email: true,
      role: true,
      status: true,
      lastLoginAt: true,
      createdAt: true,
      sshAccess: true,
      sshSudo: true,
      sshUsername: true,
      sshProvisioned: true,
    },
  });
  const presence = getPresenceMap();
  const enriched = users.map((u) => ({
    ...u,
    online: presence[u.id]?.online ?? false,
    lastSeenAt: presence[u.id]?.lastSeen ? new Date(presence[u.id]!.lastSeen).toISOString() : null,
  }));
  return NextResponse.json({ users: enriched });
}
