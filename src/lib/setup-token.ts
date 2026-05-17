import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { prisma } from './prisma';
import { getEnv } from './env';

/**
 * Setup-token lifecycle.
 *
 *  ensureSetupToken() — called at first boot. If we're in setup mode AND
 *    no token is stored, generate one + write to AppSetting `_setup_token`
 *    (underscore prefix = internal, hidden from /settings UI).
 *  validateSetupTokenParam() — the user lands at /setup?token=…; verify
 *    against the stored token in constant time, and on success issue a
 *    short-lived signed cookie so subsequent /setup requests don't need
 *    the token in the URL.
 *  hasValidSetupCookie() — middleware + setup APIs check this.
 *  invalidateSetupToken() — called by /api/setup/complete; removes the
 *    AppSetting row + clears the cookie.
 */

const COOKIE = 'cp_setup';
const COOKIE_TTL = 60 * 60; // 1h — generous since the wizard might pause
const TOKEN_KEY = '_setup_token';

export async function ensureSetupToken(): Promise<string> {
  // Env override wins for dev/test reproducibility.
  if (process.env.CP_SETUP_TOKEN) {
    // Persist the env-provided token so it survives a wizard refresh.
    await prisma.appSetting.upsert({
      where: { key: TOKEN_KEY },
      update: { value: process.env.CP_SETUP_TOKEN },
      create: { key: TOKEN_KEY, value: process.env.CP_SETUP_TOKEN },
    });
    return process.env.CP_SETUP_TOKEN;
  }
  const existing = await prisma.appSetting.findUnique({ where: { key: TOKEN_KEY } });
  if (existing?.value) return existing.value;
  const fresh = randomBytes(16).toString('hex');
  await prisma.appSetting.create({ data: { key: TOKEN_KEY, value: fresh } });
  return fresh;
}

export async function getStoredSetupToken(): Promise<string | null> {
  const row = await prisma.appSetting.findUnique({ where: { key: TOKEN_KEY } });
  return row?.value ?? null;
}

export async function invalidateSetupToken(): Promise<void> {
  await prisma.appSetting.deleteMany({ where: { key: TOKEN_KEY } });
  try {
    cookies().delete(COOKIE);
  } catch {
    // cookies() is only available in request scope; if we're called from
    // somewhere else we silently skip.
  }
}

function isHttps(): boolean {
  try {
    return new URL(getEnv().NEXTAUTH_URL).protocol === 'https:';
  } catch {
    return false;
  }
}

function sign(payload: object, ttlSeconds: number): string {
  const env = getEnv();
  const body = { ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const b64 = Buffer.from(JSON.stringify(body), 'utf8').toString('base64url');
  const sig = createHmac('sha256', env.NEXTAUTH_SECRET).update(b64).digest('base64url');
  return `${b64}.${sig}`;
}

function verify(token: string | undefined | null): boolean {
  if (!token) return false;
  const dot = token.indexOf('.');
  if (dot === -1) return false;
  const b64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const env = getEnv();
  const expected = createHmac('sha256', env.NEXTAUTH_SECRET).update(b64).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  try {
    const body = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'));
    return body.exp >= Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

/**
 * Verify the URL-borne token against AppSetting in constant time, and on
 * success set the cookie so the user can drive the rest of the wizard
 * without keeping the token in the URL bar.
 */
export async function claimSetupTokenFromUrl(urlToken: string): Promise<boolean> {
  const stored = await getStoredSetupToken();
  if (!stored) return false;
  const a = Buffer.from(urlToken);
  const b = Buffer.from(stored);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  cookies().set(COOKIE, sign({ s: 'setup' }, COOKIE_TTL), {
    httpOnly: true,
    sameSite: 'lax',
    secure: isHttps(),
    path: '/',
    maxAge: COOKIE_TTL,
  });
  return true;
}

export function hasValidSetupCookie(): boolean {
  try {
    return verify(cookies().get(COOKIE)?.value);
  } catch {
    return false;
  }
}

/**
 * Used by middleware to read the cookie from a NextRequest synchronously
 * (the `cookies()` helper from `next/headers` doesn't work there).
 */
export function verifyRawCookieValue(value: string | undefined): boolean {
  return verify(value);
}
