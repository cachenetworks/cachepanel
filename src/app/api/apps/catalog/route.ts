import { NextResponse } from 'next/server';
import { authorize } from '@/lib/api-auth';
import { APP_CATALOG } from '@/data/app-catalog';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await authorize();
  if (!auth.ok) return auth.response;
  // Strip nothing — catalog is static + non-sensitive.
  return NextResponse.json({ apps: APP_CATALOG });
}
