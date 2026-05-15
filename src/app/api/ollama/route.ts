import { NextResponse } from 'next/server';
import { authorize } from '@/lib/api-auth';
import { getOllamaStatus } from '@/lib/ollama';
import { getRequestServerId } from '@/lib/req-server';
import { getServerById } from '@/lib/servers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const auth = await authorize();
  if (!auth.ok) return auth.response;
  const server = await getServerById(getRequestServerId(req));
  const status = await getOllamaStatus(server);
  return NextResponse.json({ ...status, server: server ? { id: server.id, isPrimary: server.isPrimary } : null });
}
