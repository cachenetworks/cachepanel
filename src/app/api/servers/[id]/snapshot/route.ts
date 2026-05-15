import { NextResponse } from 'next/server';
import { authorize } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { getHostSnapshot } from '@/lib/host-probe';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await authorize();
  if (!auth.ok) return auth.response;
  const server = await prisma.server.findUnique({ where: { id: params.id } });
  if (!server) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const snap = await getHostSnapshot(server);
  return NextResponse.json({ server: { id: server.id, name: server.name, hostname: server.hostname }, snapshot: snap });
}
