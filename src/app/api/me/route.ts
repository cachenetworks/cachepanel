import { NextResponse } from 'next/server';
import { authorize } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await authorize();
  if (!auth.ok) return auth.response;
  return NextResponse.json({ user: auth.user });
}
