import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorize } from '@/lib/api-auth';
import { startApp, stopApp, updateApp, getAppLogs, AppInstallError } from '@/lib/app-installer';

export const dynamic = 'force-dynamic';

const schema = z.object({
  action: z.enum(['start', 'stop', 'update', 'logs']),
  lines: z.number().int().min(1).max(2000).optional(),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await authorize({ requireMfa: true });
  if (!auth.ok) return auth.response;
  if (auth.user.role !== 'OWNER' && auth.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'OWNER or ADMIN required' }, { status: 403 });
  }

  const raw = await req.json().catch(() => null);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }

  try {
    switch (parsed.data.action) {
      case 'start':
        await startApp(params.id);
        return NextResponse.json({ ok: true });
      case 'stop':
        await stopApp(params.id);
        return NextResponse.json({ ok: true });
      case 'update':
        await updateApp(params.id);
        return NextResponse.json({ ok: true });
      case 'logs': {
        const text = await getAppLogs(params.id, parsed.data.lines ?? 200);
        return NextResponse.json({ logs: text });
      }
    }
  } catch (err) {
    if (err instanceof AppInstallError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.httpStatus });
    }
    console.error('[apps] action failed', err);
    return NextResponse.json({ error: 'Action failed' }, { status: 500 });
  }
}
