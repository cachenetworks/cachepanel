import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { getEnv } from '@/lib/env';
import { migrateConfigFromEnv } from '@/lib/config-migrate';
import { isSetupMode } from '@/lib/config';
import { ensureSetupToken } from '@/lib/setup-token';

// HMAC-gated entry point hit by server.js once at ~20s after boot.
// Runs the .env -> AppSetting migration, then (if still in setup mode)
// returns the setup URL for server.js to print as a banner.

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const env = getEnv();
  const provided = req.headers.get('x-cachepanel-internal') ?? '';
  const expected = createHmac('sha256', env.NEXTAUTH_SECRET).update('first-boot').digest('hex');
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let migratedCount = 0;
  try {
    const m = await migrateConfigFromEnv();
    migratedCount = m.migrated.length;
  } catch (err) {
    console.error('[first-boot] migrate failed', err);
  }

  let setupUrl: string | null = null;
  try {
    if (await isSetupMode()) {
      const token = await ensureSetupToken();
      setupUrl = `${env.NEXTAUTH_URL}/setup?token=${token}`;
    }
  } catch (err) {
    console.error('[first-boot] setup-token check failed', err);
  }

  return NextResponse.json({ migratedCount, setupUrl });
}
