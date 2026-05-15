import { NextResponse } from 'next/server';
import { authorize } from '@/lib/api-auth';
import { getAllowedRoots } from '@/lib/fs-guard';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await authorize();
  if (!auth.ok) return auth.response;
  return NextResponse.json({ roots: getAllowedRoots() });
}
