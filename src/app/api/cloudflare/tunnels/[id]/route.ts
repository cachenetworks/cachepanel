import { NextResponse } from 'next/server';
import { authorize } from '@/lib/api-auth';
import { audit } from '@/lib/audit';
import { getClientIp } from '@/lib/ip';
import { deleteTunnel } from '@/lib/cloudflare';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const auth = await authorize({ requireOwner: true });
  if (!auth.ok) return auth.response;
  try {
    await deleteTunnel(params.id);
    await audit({
      userId: auth.user.id,
      action: 'settings.changed',
      target: `cf.tunnel:${params.id}`,
      metadata: { event: 'tunnel.deleted' },
      ipAddress: getClientIp(req),
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
