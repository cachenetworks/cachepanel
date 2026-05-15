import { NextResponse } from 'next/server';
import { authorize } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await authorize();
  if (!auth.ok) return auth.response;
  const sessions = await prisma.terminalSession.findMany({
    orderBy: { startedAt: 'desc' },
    take: 30,
    include: { user: { select: { username: true, avatar: true } } },
  });
  return NextResponse.json({ sessions });
}
