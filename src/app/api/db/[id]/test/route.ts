import { NextResponse } from 'next/server';
import { authorize } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { listDatabases, listTables, resolveConnection } from '@/lib/db-drivers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const auth = await authorize();
  if (!auth.ok) return auth.response;
  const conn = await prisma.dbConnection.findUnique({ where: { id: params.id } });
  if (!conn) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (conn.ownerOnly && auth.user.role !== 'OWNER') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const start = Date.now();
  try {
    const c = resolveConnection(conn);
    // For sqlite there are no databases; just hit the table list.
    if (c.driver === 'sqlite') {
      await listTables(c);
    } else {
      await listDatabases(c);
    }
    return NextResponse.json({ ok: true, durationMs: Date.now() - start });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - start },
      { status: 200 },
    );
  }
}
