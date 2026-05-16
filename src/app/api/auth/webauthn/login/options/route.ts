import { NextResponse } from 'next/server';
import { generateAuthenticationOptions } from '@simplewebauthn/server';
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

  const authenticators = await prisma.authenticator.findMany({
    where: { userId: auth.user.id },
    select: { credentialId: true, transports: true },
  });

  if (authenticators.length === 0) {
    return NextResponse.json({ error: 'No authenticators registered' }, { status: 400 });
  }

  const options = await generateAuthenticationOptions({
    rpID: env.rpID,
    timeout: 60_000,
    userVerification: 'preferred',
    allowCredentials: authenticators.map((a) => ({
      id: Buffer.from(a.credentialId).toString('base64url'),
      transports: a.transports
        ? (a.transports.split(',') as ('usb' | 'nfc' | 'ble' | 'internal' | 'hybrid')[])
        : undefined,
    })),
  });

  setChallengeCookie({
    uid: auth.user.id,
    challenge: options.challenge,
    mode: 'login',
  });

  return NextResponse.json(options);
}
