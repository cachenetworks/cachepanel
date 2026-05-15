import { NextResponse } from 'next/server';
import { authorize } from '@/lib/api-auth';
import { audit } from '@/lib/audit';
import { getClientIp } from '@/lib/ip';
import {
  deleteCname,
  findZoneForHostname,
  getTunnelConfig,
  listZones,
  setTunnelConfig,
  upsertTunnelCname,
  type CfZone,
  type IngressRule,
} from '@/lib/cloudflare';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ruleSchema = z.object({
  hostname: z.string().min(1).max(253).optional(),
  service: z.string().min(1).max(255),
  path: z.string().max(255).optional(),
});
const bodySchema = z.object({
  ingress: z.array(ruleSchema).max(50),
  // hostnames to remove from DNS (CNAME deletion). Optional cleanup hint.
  removeHostnames: z.array(z.string().max(253)).optional(),
});

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await authorize();
  if (!auth.ok) return auth.response;
  try {
    const config = await getTunnelConfig(params.id);
    return NextResponse.json({ config });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const auth = await authorize({ requireOwner: true });
  if (!auth.ok) return auth.response;
  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body', issues: parsed.error.issues }, { status: 400 });

  try {
    // Push the ingress to Cloudflare first.
    const ingress = parsed.data.ingress as IngressRule[];
    const config = await setTunnelConfig(params.id, ingress);

    // Try to upsert DNS for each hostname rule. Best-effort: a missing zone
    // (subdomain not delegated to Cloudflare) shouldn't fail the whole save.
    let zones: CfZone[] = [];
    try {
      zones = await listZones();
    } catch {
      zones = [];
    }
    const dnsResults: Array<{ hostname: string; ok: boolean; error?: string }> = [];
    for (const rule of ingress) {
      if (!rule.hostname) continue;
      const zone = findZoneForHostname(zones, rule.hostname);
      if (!zone) {
        dnsResults.push({ hostname: rule.hostname, ok: false, error: 'No matching zone in this Cloudflare account' });
        continue;
      }
      try {
        await upsertTunnelCname(zone.id, rule.hostname, params.id);
        dnsResults.push({ hostname: rule.hostname, ok: true });
      } catch (err) {
        dnsResults.push({
          hostname: rule.hostname,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Optional cleanup of stale CNAMEs (hostnames the user removed).
    for (const h of parsed.data.removeHostnames ?? []) {
      const zone = findZoneForHostname(zones, h);
      if (zone) {
        try {
          await deleteCname(zone.id, h);
        } catch {
          // best-effort
        }
      }
    }

    await audit({
      userId: auth.user.id,
      action: 'settings.changed',
      target: `cf.tunnel:${params.id}`,
      metadata: { event: 'tunnel.config.updated', rules: ingress.length, dns: dnsResults.length },
      ipAddress: getClientIp(req),
    });

    return NextResponse.json({ config, dns: dnsResults });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
