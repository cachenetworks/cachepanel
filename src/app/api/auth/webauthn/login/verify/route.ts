import { NextResponse } from 'next/server';
import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import { z } from 'zod';
import { authorize } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { getWebAuthnEnv } from '@/lib/webauthn-env';
import { popChallengeCookie, setMfaCookie } from '@/lib/webauthn';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  response: z.any(),
});

export async function POST(req: Request) {
  const auth = await authorize();
  if (!auth.ok) return auth.response;

  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const challenge = popChallengeCookie();
  if (!challenge || challenge.uid !== auth.user.id || challenge.mode !== 'login') {
    return NextResponse.json({ error: 'No active login challenge' }, { status: 400 });
  }

  const env = getWebAuthnEnv();
  if (!env.available) {
    return NextResponse.json({ error: env.reason ?? 'WebAuthn unavailable' }, { status: 400 });
  }

  const response = parsed.data.response as AuthenticationResponseJSON;
  const credIdBuf = Buffer.from(response.id, 'base64url');
  const authenticator = await prisma.authenticator.findUnique({
    where: { credentialId: credIdBuf },
  });
  if (!authenticator || authenticator.userId !== auth.user.id) {
    return NextResponse.json({ error: 'Unknown credential' }, { status: 400 });
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: env.origin,
      expectedRPID: env.rpID,
      credential: {
        id: Buffer.from(authenticator.credentialId).toString('base64url'),
        publicKey: new Uint8Array(authenticator.credentialPublicKey),
        counter: authenticator.counter,
        transports: authenticator.transports
          ? (authenticator.transports.split(',') as ('usb' | 'nfc' | 'ble' | 'internal' | 'hybrid')[])
          : undefined,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'verification failed' },
      { status: 400 },
    );
  }
  if (!verification.verified) {
    return NextResponse.json({ error: 'Assertion not verified' }, { status: 400 });
  }

  await prisma.authenticator.update({
    where: { id: authenticator.id },
    data: {
      counter: verification.authenticationInfo.newCounter,
      lastUsedAt: new Date(),
    },
  });

  setMfaCookie(auth.user.id);
  return NextResponse.json({ ok: true });
}
