import { NextResponse } from 'next/server';
import { authorize } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { audit } from '@/lib/audit';
import { getClientIp } from '@/lib/ip';
import { isReadOnlySql, resolveConnection, runQuery } from '@/lib/db-drivers';
import { querySchema } from '@/lib/db-validation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await authorize();
  if (!auth.ok) return auth.response;
  const conn = await prisma.dbConnection.findUnique({ where: { id: params.id } });
  if (!conn) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (conn.ownerOnly && auth.user.role !== 'OWNER') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const raw = await req.json().catch(() => null);
  const parsed = querySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body', issues: parsed.error.issues }, { status: 400 });
  }

  const ro = isReadOnlySql(parsed.data.sql);
  // ADMINs may run write queries only when the connection isn't readOnly.
  // OWNER always allowed (subject to driver permissions).
  if (!ro && conn.readOnly) {
    return NextResponse.json(
      { error: 'This connection is marked read-only.' },
      { status: 403 },
    );
  }

  try {
    const result = await runQuery(resolveConnection(conn), parsed.data.sql, parsed.data.database);
    await audit({
      userId: auth.user.id,
      action: 'settings.changed',
      target: `db:${conn.id}`,
      metadata: {
        event: 'db.query',
        readOnly: ro,
        durationMs: result.durationMs,
        // Truncate so audit rows stay reasonable.
        sql: parsed.data.sql.slice(0, 1000),
        rows: result.rowCount,
        affected: result.affected ?? null,
      },
      ipAddress: getClientIp(req),
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await audit({
      userId: auth.user.id,
      action: 'settings.changed',
      target: `db:${conn.id}`,
      metadata: { event: 'db.query.failed', sql: parsed.data.sql.slice(0, 1000), error: message },
      ipAddress: getClientIp(req),
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
