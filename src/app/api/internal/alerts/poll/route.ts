import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { getEnv } from '@/lib/env';
import { runAlertPollers } from '@/lib/alert-pollers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Called from server.js (same process, separate JS file) on a 60s interval.
// Auth: a constant-time HMAC of NEXTAUTH_SECRET — keeps random internet
// traffic from triggering polls, but doesn't try to be cryptographically
// novel.
export async function POST(req: Request) {
  const env = getEnv();
  const provided = req.headers.get('x-cachepanel-internal') ?? '';
  const expected = createHmac('sha256', env.NEXTAUTH_SECRET).update('alerts-poll').digest('hex');

  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  if (providedBuf.length !== expectedBuf.length || !timingSafeEqual(providedBuf, expectedBuf)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Fire-and-forget so the HTTP call returns immediately; the poll itself
  // can take 10-20s on a slow link.
  void runAlertPollers();
  return NextResponse.json({ ok: true });
}
