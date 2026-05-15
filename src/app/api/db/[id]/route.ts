import { NextResponse } from 'next/server';
import { authorize } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { audit } from '@/lib/audit';
import { getClientIp } from '@/lib/ip';
import { profileUpdateSchema } from '@/lib/db-validation';
import { encryptSecret } from '@/lib/secrets';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function loadProfile(id: string, isOwner: boolean) {
  const conn = await prisma.dbConnection.findUnique({ where: { id } });
  if (!conn) return null;
  if (conn.ownerOnly && !isOwner) return null;
  return conn;
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await authorize();
  if (!auth.ok) return auth.response;
  const conn = await loadProfile(params.id, auth.user.role === 'OWNER');
  if (!conn) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({
    connection: {
      ...conn,
      // Never reveal the encrypted blob to the browser.
      password: conn.password ? '__SET__' : null,
    },
  });
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const auth = await authorize({ requireOwner: true });
  if (!auth.ok) return auth.response;
  const existing = await prisma.dbConnection.findUnique({ where: { id: params.id } });
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const raw = await req.json().catch(() => null);
  const parsed = profileUpdateSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body', issues: parsed.error.issues }, { status: 400 });

  const d = parsed.data;
  const updated = await prisma.dbConnection.update({
    where: { id: params.id },
    data: {
      name: d.name ?? existing.name,
      driver: d.driver ?? existing.driver,
      host: d.host ?? existing.host,
      port: d.port ?? existing.port,
      username: d.username ?? existing.username,
      // Update password only when a non-empty value was sent.
      password: d.password ? encryptSecret(d.password) : existing.password,
      database: d.database ?? existing.database,
      ssl: d.ssl ?? existing.ssl,
      ownerOnly: d.ownerOnly ?? existing.ownerOnly,
      readOnly: d.readOnly ?? existing.readOnly,
      notes: d.notes ?? existing.notes,
    },
  });
  await audit({
    userId: auth.user.id,
    action: 'settings.changed',
    target: `db:${updated.id}`,
    metadata: { event: 'db.connection.updated', name: updated.name },
    ipAddress: getClientIp(req),
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const auth = await authorize({ requireOwner: true });
  if (!auth.ok) return auth.response;
  const existing = await prisma.dbConnection.findUnique({ where: { id: params.id } });
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  await prisma.dbConnection.delete({ where: { id: params.id } });
  await audit({
    userId: auth.user.id,
    action: 'settings.changed',
    target: `db:${params.id}`,
    metadata: { event: 'db.connection.deleted', name: existing.name },
    ipAddress: getClientIp(req),
  });
  return NextResponse.json({ ok: true });
}
