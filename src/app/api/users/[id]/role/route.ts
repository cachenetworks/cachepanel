import { NextResponse } from 'next/server';
import { authorize } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { audit } from '@/lib/audit';
import { emitAlert } from '@/lib/alerts';
import { getClientIp } from '@/lib/ip';
import { z } from 'zod';

const bodySchema = z.object({ role: z.enum(['OWNER', 'ADMIN']) });

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await authorize({ requireOwner: true });
  if (!auth.ok) return auth.response;

  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  const { role } = parsed.data;

  const target = await prisma.user.findUnique({ where: { id: params.id } });
  if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  // Granting ADMIN/OWNER is sensitive — require OWNER to have enrolled 2FA
  // first (only enforced if WebAuthn is actually available on this install).
  if (target.role !== role) {
    const ownerKeys = await prisma.authenticator.count({ where: { userId: auth.user.id } });
    if (ownerKeys === 0) {
      const { getWebAuthnEnv } = await import('@/lib/webauthn-env');
      if (getWebAuthnEnv().available) {
        return NextResponse.json(
          {
            error:
              'Enroll a 2FA security key on your account before changing roles. Visit /account/security.',
            code: 'OWNER_2FA_REQUIRED',
          },
          { status: 403 },
        );
      }
    }
  }

  if (target.id === auth.user.id && role !== 'OWNER') {
    return NextResponse.json(
      { error: 'You cannot demote yourself. Promote another OWNER first.' },
      { status: 400 },
    );
  }

  if (target.role === 'OWNER' && role === 'ADMIN') {
    const otherOwners = await prisma.user.count({
      where: { role: 'OWNER', status: 'APPROVED', NOT: { id: target.id } },
    });
    if (otherOwners === 0) {
      return NextResponse.json(
        { error: 'Cannot demote the only OWNER.' },
        { status: 400 },
      );
    }
  }

  const updated = await prisma.user.update({
    where: { id: target.id },
    data: { role },
  });

  await audit({
    userId: auth.user.id,
    action: 'user.role_changed',
    target: target.id,
    metadata: { from: target.role, to: role, username: target.username },
    ipAddress: getClientIp(req),
  });
  void emitAlert('user.role_changed', {
    description: `**${target.username}** role changed: **${target.role} → ${role}** (by ${auth.user.username}).`,
    fields: [
      { name: 'From', value: target.role, inline: true },
      { name: 'To', value: role, inline: true },
    ],
  });

  return NextResponse.json({ user: updated });
}
