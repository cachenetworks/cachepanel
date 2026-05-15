import { NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import { authorize } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { audit } from '@/lib/audit';
import { getClientIp } from '@/lib/ip';
import {
  deleteUserOnHost,
  disableUserOnHost,
  ensureUserKey,
  isValidLinuxUsername,
  provisionUserOnHost,
  suggestLinuxUsername,
  userKeyPaths,
} from '@/lib/per-user-ssh';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const bodySchema = z.object({
  enable: z.boolean().optional(),
  sudo: z.boolean().optional(),
  username: z.string().min(1).max(32).optional(),
});

// GET — current per-(user,server) provisioning state.
export async function GET(_req: Request, { params }: { params: { id: string; serverId: string } }) {
  const auth = await authorize();
  if (!auth.ok) return auth.response;
  if (auth.user.role !== 'OWNER' && auth.user.id !== params.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const [user, server, prov] = await Promise.all([
    prisma.user.findUnique({ where: { id: params.id } }),
    prisma.server.findUnique({ where: { id: params.serverId } }),
    prisma.userServerProvision.findUnique({
      where: { userId_serverId: { userId: params.id, serverId: params.serverId } },
    }),
  ]);
  if (!user || !server) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { publicKey } = userKeyPaths(user.id);
  let pubkey: string | null = null;
  try {
    pubkey = (await fs.readFile(publicKey, 'utf-8')).trim() || null;
  } catch {
    pubkey = null;
  }

  return NextResponse.json({
    server: { id: server.id, name: server.name, hostname: server.hostname },
    sshUsername: prov?.sshUsername ?? user.sshUsername ?? null,
    sshSudo: prov?.sshSudo ?? false,
    provisioned: prov?.provisioned ?? false,
    lastError: prov?.lastError ?? null,
    suggestedUsername: prov?.sshUsername ?? user.sshUsername ?? suggestLinuxUsername(user.username),
    publicKey: pubkey,
  });
}

// PUT — provision (enable=true) or disable (enable=false) on this server.
export async function PUT(req: Request, { params }: { params: { id: string; serverId: string } }) {
  const auth = await authorize({ requireOwner: true });
  if (!auth.ok) return auth.response;
  const target = await prisma.user.findUnique({ where: { id: params.id } });
  if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 });
  const server = await prisma.server.findUnique({ where: { id: params.serverId } });
  if (!server) return NextResponse.json({ error: 'Server not found' }, { status: 404 });

  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });

  const existing = await prisma.userServerProvision.findUnique({
    where: { userId_serverId: { userId: target.id, serverId: server.id } },
  });
  const wantEnable = parsed.data.enable ?? !existing?.provisioned;
  const wantSudo = parsed.data.sudo ?? existing?.sshSudo ?? false;
  const username = (parsed.data.username ?? existing?.sshUsername ?? target.sshUsername ?? suggestLinuxUsername(target.username)).trim();
  if (!isValidLinuxUsername(username)) {
    return NextResponse.json(
      { error: `Invalid Linux username "${username}". Use lowercase letters, digits, _, -.` },
      { status: 400 },
    );
  }

  // Disable.
  if (!wantEnable) {
    if (existing && existing.sshUsername) {
      const r = await disableUserOnHost(existing.sshUsername, server.id);
      if (!r.ok) {
        return NextResponse.json({ error: 'Disable failed: ' + r.message }, { status: 500 });
      }
    }
    const upd = await prisma.userServerProvision.upsert({
      where: { userId_serverId: { userId: target.id, serverId: server.id } },
      update: { provisioned: false, sshSudo: false, lastError: null },
      create: { userId: target.id, serverId: server.id, sshUsername: username, sshSudo: false, provisioned: false },
    });
    await audit({
      userId: auth.user.id,
      action: 'settings.changed',
      target: target.id,
      metadata: { event: 'ssh.server.disabled', serverId: server.id, linuxUser: existing?.sshUsername ?? username },
      ipAddress: getClientIp(req),
    });
    return NextResponse.json({ ok: true, provision: upd });
  }

  // Enable / re-apply.
  const { pubkey } = await ensureUserKey(target.id);
  const r = await provisionUserOnHost({ username, pubkey, sudo: wantSudo, serverId: server.id });
  if (!r.ok) {
    await prisma.userServerProvision.upsert({
      where: { userId_serverId: { userId: target.id, serverId: server.id } },
      update: { sshUsername: username, sshSudo: wantSudo, provisioned: false, lastError: r.message.slice(0, 1000) },
      create: { userId: target.id, serverId: server.id, sshUsername: username, sshSudo: wantSudo, provisioned: false, lastError: r.message.slice(0, 1000) },
    });
    return NextResponse.json({ error: 'Provisioning failed: ' + r.message }, { status: 500 });
  }
  const upd = await prisma.userServerProvision.upsert({
    where: { userId_serverId: { userId: target.id, serverId: server.id } },
    update: { sshUsername: username, sshSudo: wantSudo, provisioned: true, lastError: null },
    create: { userId: target.id, serverId: server.id, sshUsername: username, sshSudo: wantSudo, provisioned: true },
  });
  await audit({
    userId: auth.user.id,
    action: 'settings.changed',
    target: target.id,
    metadata: { event: 'ssh.server.enabled', serverId: server.id, linuxUser: username, sudo: wantSudo },
    ipAddress: getClientIp(req),
  });
  return NextResponse.json({ ok: true, provision: upd });
}

// DELETE — remove the host account on this server entirely.
export async function DELETE(req: Request, { params }: { params: { id: string; serverId: string } }) {
  const auth = await authorize({ requireOwner: true });
  if (!auth.ok) return auth.response;
  const existing = await prisma.userServerProvision.findUnique({
    where: { userId_serverId: { userId: params.id, serverId: params.serverId } },
  });
  if (!existing) return NextResponse.json({ ok: true });
  const r = await deleteUserOnHost(existing.sshUsername, params.serverId);
  if (!r.ok) return NextResponse.json({ error: 'Delete failed: ' + r.message }, { status: 500 });
  await prisma.userServerProvision.delete({
    where: { userId_serverId: { userId: params.id, serverId: params.serverId } },
  });
  await audit({
    userId: auth.user.id,
    action: 'settings.changed',
    target: params.id,
    metadata: { event: 'ssh.server.deleted', serverId: params.serverId, linuxUser: existing.sshUsername },
    ipAddress: getClientIp(req),
  });
  return NextResponse.json({ ok: true });
}
