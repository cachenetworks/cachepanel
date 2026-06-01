import { NextResponse } from 'next/server';
import { hasValidSetupCookie, invalidateSetupToken } from '@/lib/setup-token';
import { getConfig, isSetupMode } from '@/lib/config';
import { ensurePrimaryServer, resetPrimaryEnsuredCache } from '@/lib/servers';

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

  // Auto-register the install host as the primary managed server using
  // whatever the user typed in the wizard's Docker / SSH-to-host step. If
  // they left SSH blank, we skip silently — they can add a server manually
  // later from /servers.
  resetPrimaryEnsuredCache();
  let primaryCreated: { id: string; name: string; hostname: string } | null = null;
  try {
    const server = await ensurePrimaryServer();
    if (server) {
      primaryCreated = { id: server.id, name: server.name, hostname: server.hostname };
    }
  } catch (err) {
    // Don't block setup completion on this — the user can always add the
    // server manually from /servers. Log so it's visible in docker logs.
    console.warn('[setup/complete] primary server auto-create failed:', err);
  }

  await invalidateSetupToken();
  return NextResponse.json({ ok: true, primaryCreated });
}
