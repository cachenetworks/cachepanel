import { NextResponse } from 'next/server';
import { authorize } from '@/lib/api-auth';
import { getContainerLogs } from '@/lib/docker-api';
import { getRemoteContainerLogs } from '@/lib/docker-remote';
import { getRequestServerId } from '@/lib/req-server';
import { getServerById } from '@/lib/servers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const auth = await authorize();
  if (!auth.ok) return auth.response;
  if (!params.id || params.id.length < 4) {
    return NextResponse.json({ error: 'Invalid container id' }, { status: 400 });
  }
  const url = new URL(req.url);
  const tail = Math.min(Math.max(parseInt(url.searchParams.get('tail') ?? '500', 10) || 500, 1), 5000);
  const serverId = getRequestServerId(req);
  const server = await getServerById(serverId);
  const isPrimary = !!server?.isPrimary;
  try {
    const logs = isPrimary || !server
      ? await getContainerLogs(params.id, tail)
      : await getRemoteContainerLogs({ server, userId: auth.user.id }, params.id, tail);
    return NextResponse.json({ logs, tail });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
