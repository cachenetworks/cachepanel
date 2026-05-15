import { NextResponse } from 'next/server';
import { authorize } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { audit } from '@/lib/audit';
import { getClientIp } from '@/lib/ip';
import { profileCreateSchema } from '@/lib/db-validation';
import { encryptSecret } from '@/lib/secrets';
import { defaultPort } from '@/lib/db-drivers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// List profiles. ADMINs see profiles where ownerOnly=false; OWNER sees all.
export async function GET() {
  const auth = await authorize();
  if (!auth.ok) return auth.response;
  const where = auth.user.role === 'OWNER' ? {} : { ownerOnly: false };
  const conns = await prisma.dbConnection.findMany({
    where,
    orderBy: [{ driver: 'asc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      driver: true,
      host: true,
      port: true,
      username: true,
      database: true,
      ssl: true,
      ownerOnly: true,
      readOnly: true,
      notes: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return NextResponse.json({ connections: conns });
}

// Create a new profile (OWNER only).
export async function POST(req: Request) {
  const auth = await authorize({ requireOwner: true });
  if (!auth.ok) return auth.response;
  const raw = await req.json().catch(() => null);
  const parsed = profileCreateSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body', issues: parsed.error.issues }, { status: 400 });
  }
  const d = parsed.data;
  const created = await prisma.dbConnection.create({
    data: {
      name: d.name,
      driver: d.driver,
      host: d.host || null,
      port: d.port ?? (d.driver === 'sqlite' ? null : defaultPort(d.driver)),
      username: d.username || null,
      password: d.password ? encryptSecret(d.password) : null,
      database: d.database || null,
      ssl: !!d.ssl,
      ownerOnly: !!d.ownerOnly,
      readOnly: !!d.readOnly,
      notes: d.notes || null,
      createdById: auth.user.id,
    },
    select: { id: true },
  });
  await audit({
    userId: auth.user.id,
    action: 'settings.changed',
    target: `db:${created.id}`,
    metadata: { event: 'db.connection.created', name: d.name, driver: d.driver },
    ipAddress: getClientIp(req),
  });
  return NextResponse.json({ ok: true, id: created.id });
}
