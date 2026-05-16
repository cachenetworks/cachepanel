import { NextResponse } from 'next/server';
import { authorize } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await authorize();
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const cursor = url.searchParams.get('cursor') ?? undefined;
  const action = url.searchParams.get('action')?.trim() || undefined;
  const userId = url.searchParams.get('userId')?.trim() || undefined;
  const from = url.searchParams.get('from')?.trim() || undefined;
  const to = url.searchParams.get('to')?.trim() || undefined;
  const limit = Math.min(Number.parseInt(url.searchParams.get('limit') ?? '50', 10) || 50, 200);

  const where: {
    action?: { contains: string };
    userId?: string;
    createdAt?: { gte?: Date; lte?: Date };
  } = {};
  if (action) where.action = { contains: action };
  if (userId) where.userId = userId;
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = new Date(from);
    if (to) where.createdAt.lte = new Date(to);
  }

  const rows = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: { user: { select: { username: true, avatar: true, discordId: true } } },
  });

  let nextCursor: string | null = null;
  if (rows.length > limit) {
    nextCursor = rows[limit]!.id;
    rows.length = limit;
  }
  const logs = rows.map((r) => ({
    ...r,
    metadata: r.metadata ? safeParse(r.metadata) : null,
  }));
  return NextResponse.json({ logs, nextCursor });
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
