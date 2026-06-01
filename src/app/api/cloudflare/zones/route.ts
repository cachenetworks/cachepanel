import { NextResponse } from 'next/server';
import { authorize } from '@/lib/api-auth';
import { isCloudflareConfigured, listZones } from '@/lib/cloudflare';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const auth = await authorize();
  if (!auth.ok) return auth.response;
  if (!(await isCloudflareConfigured())) return NextResponse.json({ zones: [] });
  try {
    const zones = await listZones();
    return NextResponse.json({ zones });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
