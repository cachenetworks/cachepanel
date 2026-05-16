import { authorize } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function csvEscape(value: unknown): string {
  if (value == null) return '';
  const s = String(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function GET(req: Request) {
  const auth = await authorize({ requireOwner: true });
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const action = url.searchParams.get('action')?.trim() || undefined;
  const userId = url.searchParams.get('userId')?.trim() || undefined;
  const from = url.searchParams.get('from')?.trim() || undefined;
  const to = url.searchParams.get('to')?.trim() || undefined;

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

  const logs = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 50000,
    include: { user: { select: { username: true } } },
  });

  const rows = [
    ['timestamp', 'user', 'action', 'target', 'ip', 'metadata'].join(','),
    ...logs.map((l) =>
      [
        l.createdAt.toISOString(),
        l.user?.username ?? '',
        l.action,
        l.target ?? '',
        l.ipAddress ?? '',
        l.metadata ?? '',
      ]
        .map(csvEscape)
        .join(','),
    ),
  ];

  const body = rows.join('\n');
  return new NextResponse(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="cachepanel-audit-${Date.now()}.csv"`,
    },
  });
}
