import { NextResponse } from 'next/server';
import { z } from 'zod';
import { hasValidSetupCookie } from '@/lib/setup-token';
import { setConfig, ConfigKeys, isSetupMode, type ConfigKey } from '@/lib/config';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Allowlist of keys the wizard is allowed to write — keeps anyone with a
// stolen setup cookie from poking arbitrary AppSetting rows.
const ALLOWED: ConfigKey[] = [
  'discord_client_id',
  'discord_client_secret',
  'discord_guild_id',
  'discord_allowed_role_ids',
  'discord_allowed_user_ids',
  'cloudflare_api_token',
  'cloudflare_account_id',
  'ollama_host',
  'ollama_model',
];

const bodySchema = z.record(z.string(), z.union([z.string(), z.array(z.string())]));

export async function POST(req: Request) {
  if (!(await isSetupMode())) {
    return NextResponse.json({ error: 'Setup already complete' }, { status: 403 });
  }
  if (!hasValidSetupCookie()) {
    return NextResponse.json({ error: 'No valid setup cookie' }, { status: 403 });
  }
  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  for (const [key, value] of Object.entries(parsed.data)) {
    if (!(key in ConfigKeys)) continue;
    if (!ALLOWED.includes(key as ConfigKey)) continue;
    // setConfig handles type coercion via the ConfigKeys definition.
    await setConfig(key as ConfigKey, value as never);
  }

  return NextResponse.json({ ok: true });
}
