import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { authorize } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { audit } from '@/lib/audit';
import { setMfaCookie } from '@/lib/webauthn';

export const dynamic = 'force-dynamic';

const schema = z.object({ code: z.string().min(8).max(40) });

function hashCode(code: string): string {
  return createHash('sha256').update(code.toUpperCase().trim()).digest('hex');
}

export async function POST(req: Request) {
  const auth = await authorize();
  if (!auth.ok) return auth.response;

  const raw = await req.json().catch(() => null);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid code' }, { status: 400 });
  }

  const candidate = await prisma.recoveryCode.findFirst({
    where: { userId: auth.user.id, hash: hashCode(parsed.data.code), usedAt: null },
  });
  if (!candidate) {
    return NextResponse.json({ error: 'Invalid or already-used code' }, { status: 400 });
  }

  await prisma.recoveryCode.update({
    where: { id: candidate.id },
    data: { usedAt: new Date() },
  });

  setMfaCookie(auth.user.id);
  await audit({
    userId: auth.user.id,
    action: 'settings.changed',
    target: 'mfa.recovery_used',
    metadata: {},
  });

  return NextResponse.json({ ok: true });
}
