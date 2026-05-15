import { NextResponse } from 'next/server';
import { authorize } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { describeTable, resolveConnection } from '@/lib/db-drivers';

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
  const table = url.searchParams.get('table');
  const schema = url.searchParams.get('schema') || undefined;
  if (!table) return NextResponse.json({ error: 'Missing ?table' }, { status: 400 });
  try {
    const columns = await describeTable(resolveConnection(conn), table, schema);
    return NextResponse.json({ columns });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
