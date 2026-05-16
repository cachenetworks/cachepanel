import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorize } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { audit } from '@/lib/audit';
import { removeFromCrontab, syncCrontab, validateCronExpr, ScheduleError } from '@/lib/scheduled-jobs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const updateSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  cronExpr: z.string().min(5).max(40).optional(),
  command: z.string().min(1).max(2000).optional(),
  enabled: z.boolean().optional(),
});

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const auth = await authorize({ requireMfa: true });
  if (!auth.ok) return auth.response;
  if (auth.user.role !== 'OWNER' && auth.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'OWNER or ADMIN required' }, { status: 403 });
  }
  const target = await prisma.scheduledJob.findUnique({ where: { id: params.id } });
  if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const raw = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });

  if (parsed.data.cronExpr) {
    try {
      validateCronExpr(parsed.data.cronExpr);
    } catch (err) {
      if (err instanceof ScheduleError) return NextResponse.json({ error: err.message }, { status: 400 });
      throw err;
    }
  }

  const updated = await prisma.scheduledJob.update({
    where: { id: target.id },
    data: parsed.data,
  });

  try {
    await syncCrontab(target.serverId);
  } catch (err) {
    if (err instanceof ScheduleError) return NextResponse.json({ error: err.message }, { status: err.httpStatus });
    throw err;
  }

  await audit({
    userId: auth.user.id,
    action: 'settings.changed',
    target: `schedule.updated:${target.id}`,
    metadata: parsed.data,
  });
  return NextResponse.json({ job: updated });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const auth = await authorize({ requireMfa: true });
  if (!auth.ok) return auth.response;
  if (auth.user.role !== 'OWNER' && auth.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'OWNER or ADMIN required' }, { status: 403 });
  }
  const target = await prisma.scheduledJob.findUnique({ where: { id: params.id } });
  if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  try {
    await removeFromCrontab(target.serverId, target.id);
  } catch {
    // best-effort — proceed with DB delete even if remote crontab edit failed
  }
  await prisma.scheduledJob.delete({ where: { id: target.id } });
  await audit({
    userId: auth.user.id,
    action: 'settings.changed',
    target: `schedule.deleted:${target.id}`,
    metadata: { name: target.name },
  });
  return NextResponse.json({ ok: true });
}
