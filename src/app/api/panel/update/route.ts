import { NextResponse } from 'next/server';
import { authorize } from '@/lib/api-auth';
import { audit } from '@/lib/audit';
import { getUpdateStatus, applyUpdate } from '@/lib/self-update';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const auth = await authorize();
  if (!auth.ok) return auth.response;
  const status = await getUpdateStatus();
  return NextResponse.json(status);
}

export async function POST() {
  const auth = await authorize({ requireOwner: true, requireMfa: true });
  if (!auth.ok) return auth.response;
  const status = await getUpdateStatus();
  if (!status.canApply) {
    return NextResponse.json({ error: status.reason ?? 'Cannot apply update' }, { status: 409 });
  }
  await audit({
    userId: auth.user.id,
    action: 'settings.changed',
    target: 'panel.self_update',
    metadata: { from: status.current.digest, to: status.remote.digest },
  });
  const result = await applyUpdate();
  return NextResponse.json(result);
}
