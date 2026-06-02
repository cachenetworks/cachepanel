import { NextResponse } from 'next/server';
import { authorize } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { audit } from '@/lib/audit';
import { getClientIp } from '@/lib/ip';
import { ensurePrimaryServer, listServers } from '@/lib/servers';
import { resetUsingHostCache } from '@/lib/host-fs';
import { serverCreateSchema } from '@/lib/server-validation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const auth = await authorize();
  if (!auth.ok) return auth.response;
  await ensurePrimaryServer();
  const servers = await listServers();
  return NextResponse.json({ servers });
}

export async function POST(req: Request) {
  const auth = await authorize({ requireOwner: true });
  if (!auth.ok) return auth.response;
  const raw = await req.json().catch(() => null);
  const parsed = serverCreateSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body', issues: parsed.error.issues }, { status: 400 });
  }
  const d = parsed.data;
  const created = await prisma.server.create({
    data: {
      name: d.name,
      hostname: d.hostname,
      port: d.port ?? 22,
      defaultUser: d.defaultUser,
      keyName: d.keyName ?? 'cachepanel_id_ed25519',
      knownHostsName: d.knownHostsName ?? 'known_hosts',
      tags: d.tags ?? '',
      notes: d.notes ?? null,
      addedById: auth.user.id,
    },
  });
  resetUsingHostCache();
  await audit({
    userId: auth.user.id,
    action: 'settings.changed',
    target: `server:${created.id}`,
    metadata: { event: 'server.created', name: created.name, hostname: created.hostname },
    ipAddress: getClientIp(req),
  });
  return NextResponse.json({ server: created });
}
