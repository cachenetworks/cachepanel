import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from './auth';
import { prisma } from './prisma';
import { markSeen } from './presence';
import { hasValidMfaCookie } from './webauthn';
import type { Role, UserStatus } from './roles';

export interface ApiSessionUser {
  id: string;
  discordId: string;
  username: string;
  role: Role;
  status: UserStatus;
}

export type ApiAuthResult =
  | { ok: true; user: ApiSessionUser }
  | { ok: false; response: NextResponse };

export async function authorize(opts?: {
  requireOwner?: boolean;
  // Force MFA check for sensitive writes, even outside the requireOwner path.
  requireMfa?: boolean;
}): Promise<ApiAuthResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  // Always re-read from the database so role/status changes take effect immediately.
  const db = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!db) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  if (db.status === 'DISABLED') {
    return { ok: false, response: NextResponse.json({ error: 'Account disabled' }, { status: 403 }) };
  }
  if (db.status === 'PENDING') {
    return { ok: false, response: NextResponse.json({ error: 'Account pending approval' }, { status: 403 }) };
  }
  if (opts?.requireOwner && db.role !== 'OWNER') {
    return { ok: false, response: NextResponse.json({ error: 'Owner role required' }, { status: 403 }) };
  }

  // MFA check: only enforced when the user has enrolled at least one key.
  // Skipping ?: the user explicitly opted in by registering a key, so we
  // refuse sensitive writes from un-verified browsers.
  const needsMfaCheck = opts?.requireMfa === true || opts?.requireOwner === true;
  if (needsMfaCheck) {
    const enrolledCount = await prisma.authenticator.count({ where: { userId: db.id } });
    if (enrolledCount > 0 && !hasValidMfaCookie(db.id)) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: 'MFA required', code: 'MFA_REQUIRED' },
          { status: 401 },
        ),
      };
    }
  }

  markSeen(db.id);
  return {
    ok: true,
    user: {
      id: db.id,
      discordId: db.discordId,
      username: db.username,
      role: db.role as Role,
      status: db.status as UserStatus,
    },
  };
}
