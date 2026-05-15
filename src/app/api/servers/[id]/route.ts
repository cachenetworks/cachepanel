import { NextResponse } from 'next/server';
import { authorize } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { audit } from '@/lib/audit';
import { getClientIp } from '@/lib/ip';
import { serverUpdateSchema } from '@/lib/server-validation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await authorize();
  if (!auth.ok) return auth.response;
  const server = await prisma.server.findUnique({ where: { id: params.id } });
  if (!server) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ server });
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const auth = await authorize({ requireOwner: true });
  if (!auth.ok) return auth.response;
  const existing = await prisma.server.findUnique({ where: { id: params.id } });
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const raw = await req.json().catch(() => null);
  const parsed = serverUpdateSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  const d = parsed.data;
  // Locked metadata for the primary — name and isPrimary stay fixed.
  const updated = await prisma.server.update({
    where: { id: params.id },
    data: {
      name: existing.isPrimary ? existing.name : d.name ?? existing.name,
      hostname: d.hostname ?? existing.hostname,
      port: d.port ?? existing.port,
      defaultUser: d.defaultUser ?? existing.defaultUser,
      keyName: d.keyName ?? existing.keyName,
      knownHostsName: d.knownHostsName ?? existing.knownHostsName,
      tags: d.tags ?? existing.tags,
      notes: d.notes ?? existing.notes,
    },
  });
  await audit({
    userId: auth.user.id,
    action: 'settings.changed',
    target: `server:${updated.id}`,
    metadata: { event: 'server.updated', name: updated.name },
    ipAddress: getClientIp(req),
  });
  return NextResponse.json({ server: updated });
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const auth = await authorize({ requireOwner: true });
  if (!auth.ok) return auth.response;
  const existing = await prisma.server.findUnique({ where: { id: params.id } });
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (existing.isPrimary) {
    return NextResponse.json({ error: 'Cannot delete the primary server.' }, { status: 400 });
  }
  await prisma.server.delete({ where: { id: params.id } });
  await audit({
    userId: auth.user.id,
    action: 'settings.changed',
    target: `server:${params.id}`,
    metadata: { event: 'server.deleted', name: existing.name },
    ipAddress: getClientIp(req),
  });
  return NextResponse.json({ ok: true });
}
