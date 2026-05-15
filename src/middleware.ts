import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { rateLimit } from '@/lib/rate-limit';

const PUBLIC_PATHS = ['/login', '/api/auth', '/favicon.svg', '/_next', '/api/health'];

function isHttpsRequest(req: NextRequest): boolean {
  // Detect Cloudflare/Nginx forwarded scheme first, then fall back to NEXTAUTH_URL.
  const proto = req.headers.get('x-forwarded-proto');
  if (proto) return proto.split(',')[0]!.trim() === 'https';
  return (process.env.NEXTAUTH_URL || '').startsWith('https://');
}

async function readSession(req: NextRequest) {
  const https = isHttpsRequest(req);
  return getToken({
    req,
    secret: process.env.NEXTAUTH_SECRET,
    cookieName: https ? '__Secure-cachepanel.session' : 'cachepanel.session',
    secureCookie: https,
  });
}

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

function clientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]!.trim();
  return req.headers.get('x-real-ip') ?? req.headers.get('cf-connecting-ip') ?? 'unknown';
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const ip = clientIp(req);

  // Rate-limit the auth flow to dampen brute force / spam.
  if (pathname.startsWith('/api/auth/callback') || pathname.startsWith('/api/auth/signin')) {
    const rl = rateLimit(`auth:${ip}`, 20, 60_000);
    if (!rl.ok) {
      return NextResponse.json(
        { error: 'Too many requests. Please slow down.' },
        { status: 429, headers: { 'Retry-After': '60' } },
      );
    }
  }

  // Heavier rate limit on write file/user APIs as a defense-in-depth.
  if (
    pathname.startsWith('/api/files/write') ||
    pathname.startsWith('/api/files/upload') ||
    pathname.startsWith('/api/files/delete') ||
    pathname.startsWith('/api/files/rename') ||
    pathname.startsWith('/api/files/create')
  ) {
    const rl = rateLimit(`files-write:${ip}`, 60, 60_000);
    if (!rl.ok) {
      return NextResponse.json(
        { error: 'Too many file operations. Slow down.' },
        { status: 429, headers: { 'Retry-After': '30' } },
      );
    }
  }

  if (isPublic(pathname)) return NextResponse.next();

  // /pending only requires *some* session
  const token = await readSession(req);
  if (!token) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(url);
  }
  if (token.status === 'DISABLED') {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Account disabled' }, { status: 403 });
    }
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('error', 'disabled');
    return NextResponse.redirect(url);
  }
  if (token.status === 'PENDING') {
    if (pathname === '/pending') return NextResponse.next();
    if (pathname.startsWith('/api/')) {
      // Allow /api/auth/* and /api/me for the pending page; block everything else.
      if (pathname.startsWith('/api/me')) return NextResponse.next();
      return NextResponse.json({ error: 'Account pending approval' }, { status: 403 });
    }
    const url = req.nextUrl.clone();
    url.pathname = '/pending';
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.svg|api/terminal/socket).*)'],
};
