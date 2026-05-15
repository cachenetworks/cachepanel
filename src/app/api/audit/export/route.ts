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

export async function GET() {
  const auth = await authorize({ requireOwner: true });
  if (!auth.ok) return auth.response;

  const logs = await prisma.auditLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 10000,
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
