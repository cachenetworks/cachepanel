import { NextResponse } from 'next/server';
import { claimSetupTokenFromUrl, hasValidSetupCookie } from '@/lib/setup-token';
import { isSetupMode } from '@/lib/config';
import { getEnv } from '@/lib/env';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Resolve redirects against NEXTAUTH_URL rather than the inbound request URL.
// Behind a Cloudflare Tunnel the inbound URL has host `127.0.0.1:8992`, so
// `new URL('/setup', req.url)` rewrites the browser address bar to the
// loopback the user can't actually reach.
function panelUrl(path: string): string {
  const base = getEnv().NEXTAUTH_URL.replace(/\/+$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

// GET /api/setup/claim?token=<setup-token>
// Verifies the token, sets the signed setup cookie, and 302-redirects to /setup.
// Cookie writes must happen in a Route Handler (or Server Action), not in the
// Server Component for /setup — that's why this exists.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get('token') ?? '';

  // /setup is closed once setup is done — send them to /login.
  if (!(await isSetupMode())) {
    return NextResponse.redirect(panelUrl('/login'));
  }

  // Already cookied — just bounce to /setup so they don't see the token in the URL.
  if (hasValidSetupCookie()) {
    return NextResponse.redirect(panelUrl('/setup'));
  }

  if (!token) {
    return NextResponse.redirect(panelUrl('/setup'));
  }

  const ok = await claimSetupTokenFromUrl(token);
  if (!ok) {
    return NextResponse.redirect(panelUrl('/setup?error=bad-token'));
  }

  return NextResponse.redirect(panelUrl('/setup'));
}
