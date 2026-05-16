import { NextResponse } from 'next/server';
import { authorize } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { getWebAuthnEnv } from '@/lib/webauthn-env';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await authorize();
  if (!auth.ok) return auth.response;

  const env = getWebAuthnEnv();
  const authenticators = await prisma.authenticator.findMany({
    where: { userId: auth.user.id },
    select: {
      id: true,
      nickname: true,
      transports: true,
      createdAt: true,
      lastUsedAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });
  const recoveryCount = await prisma.recoveryCode.count({
    where: { userId: auth.user.id, usedAt: null },
  });

  return NextResponse.json({
    authenticators,
    recoveryCodesRemaining: recoveryCount,
    webAuthnAvailable: env.available,
    webAuthnReason: env.reason ?? null,
  });
}
