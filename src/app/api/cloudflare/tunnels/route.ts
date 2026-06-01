import { NextResponse } from 'next/server';
import { authorize } from '@/lib/api-auth';
import { audit } from '@/lib/audit';
import { getClientIp } from '@/lib/ip';
import { createTunnel, isCloudflareConfigured, listTunnels } from '@/lib/cloudflare';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const auth = await authorize();
  if (!auth.ok) return auth.response;
  if (!(await isCloudflareConfigured())) {
    return NextResponse.json({ configured: false, tunnels: [] });
  }
  try {
    const tunnels = await listTunnels();
    return NextResponse.json({ configured: true, tunnels });
  } catch (err) {
    return NextResponse.json(
      { configured: true, error: err instanceof Error ? err.message : String(err), tunnels: [] },
      { status: 500 },
    );
  }
}

const createSchema = z.object({ name: z.string().min(1).max(100) });

export async function POST(req: Request) {
  const auth = await authorize({ requireOwner: true });
  if (!auth.ok) return auth.response;
  const raw = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  try {
    const tunnel = await createTunnel(parsed.data.name);
    await audit({
      userId: auth.user.id,
      action: 'settings.changed',
      target: `cf.tunnel:${tunnel.id}`,
      metadata: { event: 'tunnel.created', name: tunnel.name },
      ipAddress: getClientIp(req),
    });
    return NextResponse.json({ tunnel });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
