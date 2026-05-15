import { NextResponse } from 'next/server';
import { authorize } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { listTables, resolveConnection } from '@/lib/db-drivers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const auth = await authorize();
  if (!auth.ok) return auth.response;
  const conn = await prisma.dbConnection.findUnique({ where: { id: params.id } });
  if (!conn) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (conn.ownerOnly && auth.user.role !== 'OWNER') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const url = new URL(req.url);
  const database = url.searchParams.get('database') || undefined;
  try {
    const tables = await listTables(resolveConnection(conn), database);
    return NextResponse.json({ tables });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
