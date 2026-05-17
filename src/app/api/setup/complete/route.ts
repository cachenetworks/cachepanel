import { NextResponse } from 'next/server';
import { hasValidSetupCookie, invalidateSetupToken } from '@/lib/setup-token';
import { getConfig, isSetupMode } from '@/lib/config';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST() {
  if (!hasValidSetupCookie()) {
    return NextResponse.json({ error: 'No valid setup cookie' }, { status: 403 });
  }
  if (!(await isSetupMode())) {
    // Already done — no-op, fall through to OK so the client redirects.
    return NextResponse.json({ ok: true, already: true });
  }
  // Don't let the user finish if Discord creds are still empty — without
  // those, the next login attempt 500s.
  const clientId = await getConfig('discord_client_id');
  const clientSecret = await getConfig('discord_client_secret');
  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: 'Cannot finish setup — Discord Client ID and Secret are required.' },
      { status: 400 },
    );
  }
  await invalidateSetupToken();
  return NextResponse.json({ ok: true });
}
