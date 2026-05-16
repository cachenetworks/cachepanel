import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { getEnv } from './env';

const MFA_COOKIE = 'cachepanel.mfa';
const CHALLENGE_COOKIE = 'cachepanel.webauthn_challenge';
const MFA_TTL_SECONDS = 60 * 60 * 12; // 12h — re-auth daily-ish
const CHALLENGE_TTL_SECONDS = 60 * 5; // 5min — register/login dance

interface SignedPayload<T> {
  data: T;
  exp: number;
}

function sign<T>(payload: T, ttlSeconds: number): string {
  const env = getEnv();
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const body: SignedPayload<T> = { data: payload, exp };
  const json = JSON.stringify(body);
  const b64 = Buffer.from(json, 'utf8').toString('base64url');
  const sig = createHmac('sha256', env.NEXTAUTH_SECRET).update(b64).digest('base64url');
  return `${b64}.${sig}`;
}

function verify<T>(token: string | undefined | null): T | null {
  if (!token) return null;
  const env = getEnv();
  const dot = token.indexOf('.');
  if (dot === -1) return null;
  const b64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac('sha256', env.NEXTAUTH_SECRET).update(b64).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null;
  try {
    const body: SignedPayload<T> = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'));
    if (body.exp < Math.floor(Date.now() / 1000)) return null;
    return body.data;
  } catch {
    return null;
  }
}

function isHttps() {
  try {
    return new URL(getEnv().NEXTAUTH_URL).protocol === 'https:';
  } catch {
    return false;
  }
}

// ---- MFA ticket (set after a successful WebAuthn assertion) ----------

interface MfaTicket {
  uid: string;
}

export function setMfaCookie(userId: string) {
  cookies().set(MFA_COOKIE, sign<MfaTicket>({ uid: userId }, MFA_TTL_SECONDS), {
    httpOnly: true,
    sameSite: 'lax',
    secure: isHttps(),
    path: '/',
    maxAge: MFA_TTL_SECONDS,
  });
}

export function clearMfaCookie() {
  cookies().delete(MFA_COOKIE);
}

export function hasValidMfaCookie(userId: string): boolean {
  const raw = cookies().get(MFA_COOKIE)?.value;
  const ticket = verify<MfaTicket>(raw);
  return ticket?.uid === userId;
}

// ---- Challenge cookie (signed transport for the WebAuthn dance) -----

interface ChallengePayload {
  uid: string;
  challenge: string; // base64url
  mode: 'register' | 'login';
}

export function setChallengeCookie(payload: ChallengePayload) {
  cookies().set(CHALLENGE_COOKIE, sign(payload, CHALLENGE_TTL_SECONDS), {
    httpOnly: true,
    sameSite: 'lax',
    secure: isHttps(),
    path: '/',
    maxAge: CHALLENGE_TTL_SECONDS,
  });
}

export function popChallengeCookie(): ChallengePayload | null {
  const raw = cookies().get(CHALLENGE_COOKIE)?.value;
  cookies().delete(CHALLENGE_COOKIE);
  return verify<ChallengePayload>(raw);
}

export function generateChallenge(): string {
  return randomBytes(32).toString('base64url');
}
