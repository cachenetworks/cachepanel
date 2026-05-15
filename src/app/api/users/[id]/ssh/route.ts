import { NextResponse } from 'next/server';
import { authorize } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { audit } from '@/lib/audit';
import { getClientIp } from '@/lib/ip';
import {
  deleteUserKey,
  deleteUserOnHost,
  disableUserOnHost,
  ensureUserKey,
  hasUserKey,
  isValidLinuxUsername,
  provisionUserOnHost,
  suggestLinuxUsername,
  userKeyPaths,
} from '@/lib/per-user-ssh';
import fs from 'node:fs/promises';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const bodySchema = z.object({
  enable: z.boolean().optional(),
  sudo: z.boolean().optional(),
  username: z.string().min(1).max(32).optional(),
});

// GET — current SSH config + the public key (so the UI can copy/paste it).
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await authorize();
  if (!auth.ok) return auth.response;
  // OWNER can see anyone; ADMIN may only see themselves.
  if (auth.user.role !== 'OWNER' && auth.user.id !== params.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const user = await prisma.user.findUnique({ where: { id: params.id } });
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });
  const { publicKey } = userKeyPaths(user.id);
  let pubkey: string | null = null;
  if (hasUserKey(user.id)) {
    pubkey = (await fs.readFile(publicKey, 'utf-8').catch(() => '')).trim() || null;
  }
  return NextResponse.json({
    sshAccess: user.sshAccess,
    sshSudo: user.sshSudo,
    sshUsername: user.sshUsername,
    sshProvisioned: user.sshProvisioned,
    suggestedUsername: user.sshUsername ?? suggestLinuxUsername(user.username),
    publicKey: pubkey,
  });
}

// PUT — toggle ssh access / sudo, change username.
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const auth = await authorize({ requireOwner: true });
  if (!auth.ok) return auth.response;

  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });

  const target = await prisma.user.findUnique({ where: { id: params.id } });
  if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  // Resolve the desired Linux username.
  let username = (parsed.data.username ?? target.sshUsername ?? suggestLinuxUsername(target.username)).trim();
  if (!isValidLinuxUsername(username)) {
    return NextResponse.json(
      {
        error: `Invalid Linux username "${username}". Must match ^[a-z_][a-z0-9_-]{0,31}$ — letters, digits, _ and -.`,
      },
      { status: 400 },
    );
  }

  const wantAccess = parsed.data.enable ?? target.sshAccess;
  const wantSudo = parsed.data.sudo ?? target.sshSudo;

  // Re-disable case: turn it off entirely.
  if (!wantAccess && target.sshAccess) {
    if (target.sshUsername) {
      const r = await disableUserOnHost(target.sshUsername);
      if (!r.ok) {
        return NextResponse.json({ error: 'Disable on host failed: ' + r.message }, { status: 500 });
      }
    }
    const updated = await prisma.user.update({
      where: { id: target.id },
      data: { sshAccess: false, sshSudo: false, sshProvisioned: false },
    });
    await audit({
      userId: auth.user.id,
      action: 'settings.changed',
      target: target.id,
      metadata: { ssh: 'disabled', linuxUser: target.sshUsername },
      ipAddress: getClientIp(req),
    });
    return NextResponse.json({ ok: true, user: updated });
  }

  // Enable / re-provision case.
  if (wantAccess) {
    const { pubkey } = await ensureUserKey(target.id);
    const r = await provisionUserOnHost({ username, pubkey, sudo: wantSudo });
    if (!r.ok) {
      return NextResponse.json({ error: 'Provisioning failed: ' + r.message }, { status: 500 });
    }
    const updated = await prisma.user.update({
      where: { id: target.id },
      data: {
        sshAccess: true,
        sshSudo: wantSudo,
        sshUsername: username,
        sshProvisioned: true,
      },
    });
    await audit({
      userId: auth.user.id,
      action: 'settings.changed',
      target: target.id,
      metadata: { ssh: 'enabled', linuxUser: username, sudo: wantSudo },
      ipAddress: getClientIp(req),
    });
    return NextResponse.json({ ok: true, user: updated });
  }

  // No-op (nothing changed).
  return NextResponse.json({ ok: true, user: target });
}

// DELETE — fully delete the host account + key. Destructive, OWNER only.
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const auth = await authorize({ requireOwner: true });
  if (!auth.ok) return auth.response;
  const target = await prisma.user.findUnique({ where: { id: params.id } });
  if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  if (target.sshUsername) {
    const r = await deleteUserOnHost(target.sshUsername);
    if (!r.ok) {
      return NextResponse.json({ error: 'Delete on host failed: ' + r.message }, { status: 500 });
    }
  }
  await deleteUserKey(target.id);
  const updated = await prisma.user.update({
    where: { id: target.id },
    data: { sshAccess: false, sshSudo: false, sshProvisioned: false, sshUsername: null },
  });
  await audit({
    userId: auth.user.id,
    action: 'settings.changed',
    target: target.id,
    metadata: { ssh: 'deleted', linuxUser: target.sshUsername },
    ipAddress: getClientIp(req),
  });
  return NextResponse.json({ ok: true, user: updated });
}
