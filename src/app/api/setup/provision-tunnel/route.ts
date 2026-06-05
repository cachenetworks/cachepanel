import { NextResponse } from 'next/server';
import { z } from 'zod';
import { hasValidSetupCookie } from '@/lib/setup-token';
import {
  createTunnel,
  findZoneForHostname,
  getTunnelToken,
  listTunnels,
  listZones,
  setTunnelConfig,
  upsertTunnelCname,
  validateCloudflareCreds,
} from '@/lib/cloudflare';
import { setConfig } from '@/lib/config';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// POST /api/setup/provision-tunnel
// Body: { token, accountId, hostname, tunnelName?, localService? }
//
// Idempotently:
//   1. Validates the Cloudflare creds.
//   2. Saves them to AppSetting (so subsequent calls don't need them re-pasted).
//   3. Finds-or-creates a tunnel named {tunnelName} (default: cachepanel).
//   4. Sets the tunnel's ingress to route {hostname} → {localService}
//      (default: http://localhost:8992).
//   5. Upserts a proxied CNAME at {hostname} → {tunnelId}.cfargotunnel.com.
//   6. Returns the connector token + a copy-paste install command.
//
// The user still has to install the connector somewhere — we hand them the
// docker / debian / systemd one-liner with the token pre-filled.
const bodySchema = z.object({
  token: z.string().min(1),
  accountId: z.string().min(1),
  hostname: z.string().min(1),
  tunnelName: z.string().min(1).max(100).optional(),
  localService: z.string().min(1).optional(),
});

const HOSTNAME_RE = /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i;

export async function POST(req: Request) {
  if (!hasValidSetupCookie()) {
    return NextResponse.json({ ok: false, message: 'Setup session expired.' }, { status: 403 });
  }
  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: 'Invalid body.' }, { status: 400 });
  }
  const { token, accountId } = parsed.data;
  const hostname = parsed.data.hostname.trim().toLowerCase();
  const tunnelName = (parsed.data.tunnelName ?? 'cachepanel').trim();
  const localService = (parsed.data.localService ?? 'http://localhost:8992').trim();

  if (!HOSTNAME_RE.test(hostname)) {
    return NextResponse.json({
      ok: false,
      message: `"${hostname}" doesn't look like a valid hostname (e.g. panel.example.com).`,
    });
  }

  // 1. Validate creds upfront. If this fails the user gets a sharp message
  //    instead of an opaque mid-flow error.
  const validation = await validateCloudflareCreds(token, accountId);
  if (!validation.ok) {
    return NextResponse.json({ ok: false, stage: 'validate', message: validation.message });
  }

  // 2. Persist creds so the tunnels page works post-setup without re-paste.
  await setConfig('cloudflare_api_token', token);
  await setConfig('cloudflare_account_id', accountId);

  try {
    // 3. Find a matching zone for the hostname.
    const zones = await listZones();
    const zone = findZoneForHostname(zones, hostname);
    if (!zone) {
      return NextResponse.json({
        ok: false,
        stage: 'zone-lookup',
        message: `No zone in your Cloudflare account matches "${hostname}". Add the apex domain to Cloudflare first (e.g. example.com), then retry.`,
        availableZones: zones.map((z) => z.name),
      });
    }

    // 4. Find-or-create the tunnel.
    const existing = (await listTunnels()).find((t) => t.name === tunnelName && !t.deleted_at);
    let tunnelId: string;
    let tunnelToken: string | undefined;
    let reused = false;
    if (existing) {
      tunnelId = existing.id;
      reused = true;
      // Re-issue the token so the user can re-enroll if they lost it.
      try {
        tunnelToken = await getTunnelToken(tunnelId);
      } catch {
        /* non-fatal */
      }
    } else {
      const created = await createTunnel(tunnelName);
      tunnelId = created.id;
      tunnelToken = created.token;
    }

    // 5. Set ingress: {hostname} → {localService}, with the required catch-all.
    await setTunnelConfig(tunnelId, [
      {
        hostname,
        service: localService,
        originRequest: { noTLSVerify: true },
      },
    ]);

    // 6. Upsert CNAME.
    await upsertTunnelCname(zone.id, hostname, tunnelId);

    // Build the connector install command. Three styles — Docker, Debian, generic.
    const dockerCmd = tunnelToken
      ? `docker run -d --name cloudflared --restart unless-stopped --network host cloudflare/cloudflared:latest tunnel --no-autoupdate run --token ${tunnelToken}`
      : null;
    const debianCmd = tunnelToken
      ? `sudo cloudflared service install ${tunnelToken} && sudo systemctl enable --now cloudflared`
      : null;
    // v1.8.0: Windows variant. cloudflared ships a Windows MSI; we link to
    // the installer page rather than auto-downloading, since the user may
    // need to choose between amd64 / arm64. Once installed, the service is
    // identical (`cloudflared service install <token>`).
    const windowsCmd = tunnelToken
      ? `# Install: winget install -e --id Cloudflare.cloudflared\r\ncloudflared.exe service install ${tunnelToken}`
      : null;

    return NextResponse.json({
      ok: true,
      stage: reused ? 'reused' : 'created',
      tunnelId,
      tunnelName,
      hostname,
      zone: zone.name,
      // Cloudflare doesn't always re-issue the token on getTunnelToken for
      // long-running tunnels (returns empty). Tell the UI when that happens.
      tunnelToken: tunnelToken ?? null,
      dockerCmd,
      debianCmd,
      windowsCmd,
      message: reused
        ? `Reused existing tunnel "${tunnelName}", updated ingress + DNS for ${hostname}.`
        : `Created tunnel "${tunnelName}", routed ${hostname} → ${localService}.`,
    });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      stage: 'cloudflare-api',
      message: err instanceof Error ? err.message : String(err),
    });
  }
}
