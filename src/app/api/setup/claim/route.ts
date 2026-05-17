import { NextResponse } from 'next/server';
import { claimSetupTokenFromUrl, hasValidSetupCookie } from '@/lib/setup-token';
import { isSetupMode } from '@/lib/config';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/setup/claim?token=<setup-token>
// Verifies the token, sets the signed setup cookie, and 302-redirects to /setup.
// Cookie writes must happen in a Route Handler (or Server Action), not in the
// Server Component for /setup — that's why this exists.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get('token') ?? '';

  // /setup is closed once setup is done — send them to /login.
  if (!(await isSetupMode())) {
    return NextResponse.redirect(new URL('/login', url));
  }

  // Already cookied — just bounce to /setup so they don't see the token in the URL.
  if (hasValidSetupCookie()) {
    return NextResponse.redirect(new URL('/setup', url));
  }

  if (!token) {
    return NextResponse.redirect(new URL('/setup', url));
  }

  const ok = await claimSetupTokenFromUrl(token);
  if (!ok) {
    return NextResponse.redirect(new URL('/setup?error=bad-token', url));
  }

  return NextResponse.redirect(new URL('/setup', url));
}
