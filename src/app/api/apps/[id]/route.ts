import { NextResponse } from 'next/server';
import { authorize } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { audit } from '@/lib/audit';
import { emitAlert } from '@/lib/alerts';
import { uninstallApp, AppInstallError } from '@/lib/app-installer';
import { getCatalogApp } from '@/data/app-catalog';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await authorize();
  if (!auth.ok) return auth.response;

  const app = await prisma.installedApp.findUnique({
    where: { id: params.id },
    include: { server: { select: { id: true, name: true, isPrimary: true } } },
  });
  if (!app) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const catalog = getCatalogApp(app.slug);
  return NextResponse.json({
    id: app.id,
    slug: app.slug,
    name: app.name,
    status: app.status,
    ports: safeParse(app.ports, [] as Array<{ public: number; container: number }>),
    variables: safeParse(app.variables, {} as Record<string, string>),
    composeYaml: app.composeYaml,
    imageTag: app.imageTag,
    hasUpdate: app.hasUpdate,
    installedAt: app.installedAt,
    server: app.server,
    catalog: catalog
      ? { description: catalog.description, links: catalog.links, icon: catalog.icon }
      : null,
  });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const auth = await authorize({ requireMfa: true });
  if (!auth.ok) return auth.response;
  if (auth.user.role !== 'OWNER' && auth.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'OWNER or ADMIN required' }, { status: 403 });
  }

  const target = await prisma.installedApp.findUnique({ where: { id: params.id } });
  if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  try {
    await uninstallApp(params.id);
    await audit({
      userId: auth.user.id,
      action: 'settings.changed',
      target: `app.uninstalled:${target.slug}`,
      metadata: { serverId: target.serverId },
    });
    void emitAlert('app.uninstalled', {
      description: `**${target.slug}** uninstalled by **${auth.user.username}**.`,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AppInstallError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.httpStatus });
    }
    console.error('[apps] uninstall failed', err);
    return NextResponse.json({ error: 'Uninstall failed' }, { status: 500 });
  }
}

function safeParse<T>(s: string, fallback: T): T {
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}
