import { NextResponse } from 'next/server';
import { networkInterfaces } from 'node:os';
import { promises as fs } from 'node:fs';
import { hasValidSetupCookie } from '@/lib/setup-token';
import { getEnv } from '@/lib/env';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/setup/context
// Returns deployment-context info for the welcome step so it can tell the
// user, e.g., "your panel will be at https://X, Discord redirect is Y, docker
// socket is mounted ✔, you have N network interfaces visible".

interface Iface {
  name: string;
  address: string;
  family: 'IPv4' | 'IPv6';
}

export async function GET() {
  if (!hasValidSetupCookie()) {
    return NextResponse.json({ error: 'Setup session expired.' }, { status: 403 });
  }
  const env = getEnv();
  const publicUrl = env.NEXTAUTH_URL.replace(/\/+$/, '');
  const callbackUrl = `${publicUrl}/api/auth/callback/discord`;

  // Best-effort: detect if we appear to be behind a Cloudflare Tunnel.
  // The container itself can't tell directly, but a public-https NEXTAUTH_URL
  // bound to 127.0.0.1 on the panel side is a strong tunnel signal.
  const looksLocal = /(^http:\/\/(localhost|127\.|10\.|192\.168\.|172\.))/i.test(publicUrl);
  const looksHttps = publicUrl.startsWith('https://');

  const interfaces: Iface[] = [];
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.internal) continue;
      if (a.family !== 'IPv4' && a.family !== 'IPv6') continue;
      interfaces.push({ name, address: a.address, family: a.family });
    }
  }

  // Quick socket-presence check (NOT a full /_ping, that's the docker
  // validation endpoint's job). Just tells the user whether the mount is even
  // there before they get to the Docker step.
  let dockerSocketMounted = false;
  try {
    const stat = await fs.stat(process.env.DOCKER_SOCKET || '/var/run/docker.sock');
    dockerSocketMounted = stat.isSocket();
  } catch {
    dockerSocketMounted = false;
  }

  return NextResponse.json({
    publicUrl,
    callbackUrl,
    looksLocal,
    looksHttps,
    interfaces,
    dockerSocketMounted,
    nodeVersion: process.version,
    platform: `${process.platform}/${process.arch}`,
  });
}
