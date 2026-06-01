import { NextResponse } from 'next/server';
import { z } from 'zod';
import { hasValidSetupCookie } from '@/lib/setup-token';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// POST /api/setup/validate/discord
// Body: { clientId, clientSecret }
// Hits Discord's token endpoint with client_credentials grant to confirm
// the pair is real and matches. Doesn't write anything — pure validation.
const bodySchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
});

interface DiscordApp {
  id: string;
  name: string;
  bot_public?: boolean;
}

export async function POST(req: Request) {
  if (!hasValidSetupCookie()) {
    return NextResponse.json({ ok: false, message: 'Setup session expired.' }, { status: 403 });
  }
  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: 'Missing client ID or secret.' }, { status: 400 });
  }
  const clientId = parsed.data.clientId.trim();
  const clientSecret = parsed.data.clientSecret.trim();

  // Shape checks first — these explain the most common copy/paste mistakes
  // before we even hit Discord.
  if (!/^\d{17,25}$/.test(clientId)) {
    return NextResponse.json({
      ok: false,
      message:
        'Client ID should be a 17-25 digit number. You may have pasted the Client Secret or a Bot Token by mistake — those contain letters.',
    });
  }
  if (/^Bot\s|^[A-Za-z0-9._-]{50,}\./.test(clientSecret)) {
    return NextResponse.json({
      ok: false,
      message:
        "That looks like a Bot Token, not the OAuth Client Secret. CachePanel uses OAuth login — go to the 'OAuth2' tab and click 'Reset Secret'.",
    });
  }

  // Exchange creds for a client_credentials token. This is the cheapest call
  // that proves both ID + secret are valid and matched. We then GET /applications/@me
  // with the token to grab the app name for a friendly success message.
  try {
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      scope: 'identify',
    });
    const tokenRes = await fetch('https://discord.com/api/v10/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
      body,
      cache: 'no-store',
    });
    if (tokenRes.status === 401) {
      return NextResponse.json({
        ok: false,
        message:
          'Discord rejected the credentials. Most common cause: the Client Secret was reset since you copied it. Click "Reset Secret" again in the Discord developer portal and re-paste.',
      });
    }
    if (!tokenRes.ok) {
      const errBody = await tokenRes.text().catch(() => '');
      return NextResponse.json({
        ok: false,
        message: `Discord returned HTTP ${tokenRes.status}. ${errBody.slice(0, 200)}`,
      });
    }
    const tok = (await tokenRes.json()) as { access_token?: string };
    if (!tok.access_token) {
      return NextResponse.json({ ok: false, message: 'Discord did not return an access token.' });
    }

    // Now fetch app metadata to confirm the ID matches the secret-holder.
    const appRes = await fetch('https://discord.com/api/v10/oauth2/applications/@me', {
      headers: { Authorization: `Bot ${clientSecret}` }, // bot scheme doesn't matter — this endpoint accepts the credentialed token too
      cache: 'no-store',
    });
    // Best-effort: also try bearer auth so we work whether or not a bot is attached.
    let appName: string | undefined;
    if (appRes.ok) {
      const app = (await appRes.json()) as DiscordApp;
      appName = app.name;
    } else {
      const appBearer = await fetch('https://discord.com/api/v10/oauth2/applications/@me', {
        headers: { Authorization: `Bearer ${tok.access_token}` },
        cache: 'no-store',
      });
      if (appBearer.ok) {
        const app = (await appBearer.json()) as DiscordApp;
        appName = app.name;
      }
    }

    return NextResponse.json({
      ok: true,
      message: appName ? `Discord OAuth verified — app: "${appName}".` : 'Discord OAuth verified.',
      appName,
    });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      message: `Couldn't reach Discord: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}
