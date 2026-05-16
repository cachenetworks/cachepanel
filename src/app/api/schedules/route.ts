import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorize } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { audit } from '@/lib/audit';
import { syncCrontab, validateCronExpr, ScheduleError } from '@/lib/scheduled-jobs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const auth = await authorize();
  if (!auth.ok) return auth.response;
  const jobs = await prisma.scheduledJob.findMany({
    include: { server: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json({ jobs });
}

const createSchema = z.object({
  serverId: z.string().min(1),
  name: z.string().min(1).max(80),
  cronExpr: z.string().min(5).max(40),
  command: z.string().min(1).max(2000),
  enabled: z.boolean().optional().default(true),
});

export async function POST(req: Request) {
  const auth = await authorize({ requireMfa: true });
  if (!auth.ok) return auth.response;
  if (auth.user.role !== 'OWNER' && auth.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'OWNER or ADMIN required' }, { status: 403 });
  }
  const raw = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body', issues: parsed.error.issues }, { status: 400 });
  }
  try {
    validateCronExpr(parsed.data.cronExpr);
  } catch (err) {
    if (err instanceof ScheduleError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }

  const created = await prisma.scheduledJob.create({
    data: {
      serverId: parsed.data.serverId,
      name: parsed.data.name,
      cronExpr: parsed.data.cronExpr,
      command: parsed.data.command,
      enabled: parsed.data.enabled,
      createdById: auth.user.id,
    },
  });

  try {
    await syncCrontab(parsed.data.serverId);
  } catch (err) {
    // Roll back the row if we couldn't write the crontab.
    await prisma.scheduledJob.delete({ where: { id: created.id } });
    if (err instanceof ScheduleError) return NextResponse.json({ error: err.message }, { status: err.httpStatus });
    throw err;
  }

  await audit({
    userId: auth.user.id,
    action: 'settings.changed',
    target: `schedule.created:${created.id}`,
    metadata: { name: parsed.data.name, cronExpr: parsed.data.cronExpr, serverId: parsed.data.serverId },
  });

  return NextResponse.json({ job: created });
}
