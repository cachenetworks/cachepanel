import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorize } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { audit } from '@/lib/audit';
import { emitAlert } from '@/lib/alerts';
import { installApp, AppInstallError } from '@/lib/app-installer';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await authorize();
  if (!auth.ok) return auth.response;

  const apps = await prisma.installedApp.findMany({
    include: { server: { select: { id: true, name: true, isPrimary: true } } },
    orderBy: { installedAt: 'desc' },
  });

  return NextResponse.json({
    apps: apps.map((a) => ({
      id: a.id,
      slug: a.slug,
      name: a.name,
      status: a.status,
      ports: safeParse(a.ports, [] as Array<{ public: number; container: number }>),
      imageTag: a.imageTag,
      hasUpdate: a.hasUpdate,
      installedAt: a.installedAt,
      server: a.server,
    })),
  });
}

const installSchema = z.object({
  serverId: z.string().min(1),
  slug: z.string().min(1),
  variables: z.record(z.string()),
});

export async function POST(req: Request) {
  // OWNER + ADMIN can install; requireMfa makes sure 2FA users have proved this browser.
  const auth = await authorize({ requireMfa: true });
  if (!auth.ok) return auth.response;
  if (auth.user.role !== 'OWNER' && auth.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'OWNER or ADMIN required' }, { status: 403 });
  }

  const raw = await req.json().catch(() => null);
  const parsed = installSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body', issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const result = await installApp({
      serverId: parsed.data.serverId,
      slug: parsed.data.slug,
      variables: parsed.data.variables,
      installedById: auth.user.id,
    });
    await audit({
      userId: auth.user.id,
      action: 'settings.changed',
      target: `app.installed:${result.slug}`,
      metadata: { serverId: parsed.data.serverId, appId: result.appId },
    });
    void emitAlert('app.installed', {
      description: `**${parsed.data.slug}** installed by **${auth.user.username}**.`,
      fields: [{ name: 'App', value: parsed.data.slug, inline: true }],
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof AppInstallError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.httpStatus });
    }
    console.error('[apps] install failed', err);
    return NextResponse.json({ error: 'Install failed' }, { status: 500 });
  }
}

function safeParse<T>(s: string, fallback: T): T {
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}
