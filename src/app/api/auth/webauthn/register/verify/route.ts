import { NextResponse } from 'next/server';
import { randomBytes, createHash } from 'node:crypto';
import { verifyRegistrationResponse } from '@simplewebauthn/server';
import type { RegistrationResponseJSON } from '@simplewebauthn/server';
import { z } from 'zod';
import { authorize } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { audit } from '@/lib/audit';
import { emitAlert } from '@/lib/alerts';
import { getWebAuthnEnv } from '@/lib/webauthn-env';
import { popChallengeCookie, setMfaCookie } from '@/lib/webauthn';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  nickname: z.string().min(1).max(60),
  response: z.any(), // shape validated by @simplewebauthn
});

function generateRecoveryCodes(): string[] {
  // 10 codes, 4 groups of 4 base32 chars, hyphenated.
  return Array.from({ length: 10 }, () => {
    const bytes = randomBytes(10);
    const alphabet = 'ABCDEFGHJKMNPQRSTVWXYZ23456789'; // no I, L, O, 0, 1 (visually ambiguous)
    let s = '';
    for (let i = 0; i < 16; i++) s += alphabet[bytes[i % bytes.length] % alphabet.length];
    return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}`;
  });
}

function hashCode(code: string): string {
  // Plain SHA-256 of normalized code is fine here — codes are 80-bit random and
  // one-shot. Bcrypt would be overkill for non-password tokens.
  return createHash('sha256').update(code.toUpperCase()).digest('hex');
}

export async function POST(req: Request) {
  const auth = await authorize();
  if (!auth.ok) return auth.response;

  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const challenge = popChallengeCookie();
  if (!challenge || challenge.uid !== auth.user.id || challenge.mode !== 'register') {
    return NextResponse.json({ error: 'No active registration challenge' }, { status: 400 });
  }

  const env = getWebAuthnEnv();
  if (!env.available) {
    return NextResponse.json({ error: env.reason ?? 'WebAuthn unavailable' }, { status: 400 });
  }

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: parsed.data.response as RegistrationResponseJSON,
      expectedChallenge: challenge.challenge,
      expectedOrigin: env.origin,
      expectedRPID: env.rpID,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'verification failed' },
      { status: 400 },
    );
  }
  if (!verification.verified || !verification.registrationInfo) {
    return NextResponse.json({ error: 'Registration not verified' }, { status: 400 });
  }

  const { credential } = verification.registrationInfo;
  const transports = (parsed.data.response as RegistrationResponseJSON).response?.transports ?? [];

  await prisma.authenticator.create({
    data: {
      userId: auth.user.id,
      credentialId: Buffer.from(credential.id, 'base64url'),
      credentialPublicKey: Buffer.from(credential.publicKey),
      counter: credential.counter,
      transports: transports.join(','),
      nickname: parsed.data.nickname,
    },
  });

  // First key on this account? Mint a fresh batch of recovery codes (replaces
  // any old ones — usual model for "re-enroll your account").
  const existing = await prisma.authenticator.count({ where: { userId: auth.user.id } });
  let codes: string[] | undefined;
  if (existing === 1) {
    await prisma.recoveryCode.deleteMany({ where: { userId: auth.user.id } });
    codes = generateRecoveryCodes();
    await prisma.recoveryCode.createMany({
      data: codes.map((code) => ({ userId: auth.user.id, hash: hashCode(code) })),
    });
  }

  // Newly enrolled key trusts this browser immediately.
  setMfaCookie(auth.user.id);

  await audit({
    userId: auth.user.id,
    action: 'settings.changed',
    target: 'mfa.enrolled',
    metadata: { nickname: parsed.data.nickname, firstKey: existing === 1 },
  });
  void emitAlert('mfa.enrolled', {
    description: `**${auth.user.username}** added a security key (${parsed.data.nickname}).`,
  });

  return NextResponse.json({ ok: true, recoveryCodes: codes ?? null });
}
