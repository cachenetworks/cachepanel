import { NextResponse } from 'next/server';
import { generateRegistrationOptions } from '@simplewebauthn/server';
import { authorize } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { getWebAuthnEnv } from '@/lib/webauthn-env';
import { setChallengeCookie } from '@/lib/webauthn';

export const dynamic = 'force-dynamic';

export async function POST() {
  const auth = await authorize();
  if (!auth.ok) return auth.response;

  const env = getWebAuthnEnv();
  if (!env.available) {
    return NextResponse.json({ error: env.reason ?? 'WebAuthn unavailable' }, { status: 400 });
  }

  const existing = await prisma.authenticator.findMany({
    where: { userId: auth.user.id },
    select: { credentialId: true, transports: true },
  });

  const options = await generateRegistrationOptions({
    rpName: env.rpName,
    rpID: env.rpID,
    userID: new TextEncoder().encode(auth.user.id),
    userName: auth.user.username,
    timeout: 60_000,
    attestationType: 'none',
    excludeCredentials: existing.map((a) => ({
      id: new Uint8Array(a.credentialId).buffer
        ? Buffer.from(a.credentialId).toString('base64url')
        : '',
      transports: a.transports
        ? (a.transports.split(',') as ('usb' | 'nfc' | 'ble' | 'internal' | 'hybrid')[])
        : undefined,
    })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
  });

  setChallengeCookie({
    uid: auth.user.id,
    challenge: options.challenge,
    mode: 'register',
  });

  return NextResponse.json(options);
}
