import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorize } from '@/lib/api-auth';
import { getAlertSettings, setAlertSettings, type AlertEvent } from '@/lib/alerts';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ALL_EVENTS: AlertEvent[] = [
  'login.success',
  'user.approved',
  'user.role_changed',
  'mfa.enrolled',
  'mfa.removed',
  'container.died',
  'disk.high',
  'server.unreachable',
  'server.recovered',
  'app.installed',
  'app.uninstalled',
  'app.update_available',
];

const updateSchema = z.object({
  url: z.string().url().or(z.literal('')).optional(),
  enabled: z.record(z.boolean()).optional(),
});

export async function GET() {
  const auth = await authorize({ requireOwner: true });
  if (!auth.ok) return auth.response;
  const current = await getAlertSettings();
  return NextResponse.json({
    url: current.url,
    enabled: current.enabled,
    availableEvents: ALL_EVENTS,
  });
}

export async function PUT(req: Request) {
  const auth = await authorize({ requireOwner: true });
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', issues: parsed.error.issues }, { status: 400 });
  }

  // Filter enabled map to only known event types so unknown keys can't poison it.
  let enabled: Partial<Record<AlertEvent, boolean>> | undefined;
  if (parsed.data.enabled) {
    enabled = {};
    for (const key of ALL_EVENTS) {
      if (parsed.data.enabled[key] !== undefined) enabled[key] = parsed.data.enabled[key];
    }
  }

  await setAlertSettings({
    url: parsed.data.url,
    enabled,
  });

  await audit({
    userId: auth.user.id,
    action: 'settings.changed',
    target: 'alerts',
    metadata: {
      urlChanged: parsed.data.url !== undefined,
      enabledChanged: parsed.data.enabled !== undefined,
    },
  });

  return NextResponse.json({ ok: true });
}
