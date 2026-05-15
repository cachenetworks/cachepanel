import { NextResponse } from 'next/server';
import { authorize } from '@/lib/api-auth';
import { getTunnelToken } from '@/lib/cloudflare';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await authorize({ requireOwner: true });
  if (!auth.ok) return auth.response;
  try {
    const token = await getTunnelToken(params.id);
    return NextResponse.json({ token });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
