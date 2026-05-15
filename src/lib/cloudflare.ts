// Thin Cloudflare API client for the Tunnels page.
// Docs: https://developers.cloudflare.com/api/operations/cloudflare-tunnel-list-cloudflare-tunnels

const API = 'https://api.cloudflare.com/client/v4';

export function isCloudflareConfigured(): boolean {
  return !!(process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID);
}

interface CfEnvelope<T> {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  messages: unknown[];
  result: T;
  result_info?: { page: number; per_page: number; total_count: number };
}

async function cf<T>(path: string, init?: RequestInit): Promise<T> {
  if (!isCloudflareConfigured()) {
    throw new Error('Cloudflare is not configured. Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID.');
  }
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
      'Content-Type': 'application/json',
      ...(init?.headers as Record<string, string> | undefined),
    },
    cache: 'no-store',
  });
  let body: CfEnvelope<T> | { errors?: Array<{ message: string }> };
  try {
    body = (await res.json()) as CfEnvelope<T>;
  } catch {
    throw new Error(`Cloudflare ${res.status}: ${res.statusText}`);
  }
  const env = body as CfEnvelope<T>;
  if (!res.ok || !env.success) {
    const msg = env.errors?.[0]?.message || `HTTP ${res.status}`;
    throw new Error(`Cloudflare API: ${msg}`);
  }
  return env.result;
}

// ---------- Tunnels ----------

export interface CfTunnel {
  id: string;
  name: string;
  status: 'inactive' | 'degraded' | 'healthy' | 'down' | string;
  created_at: string;
  deleted_at: string | null;
  connections: Array<{
    colo_name?: string;
    is_pending_reconnect?: boolean;
    opened_at?: string;
    origin_ip?: string;
    uuid?: string;
  }>;
  account_tag?: string;
  metadata?: Record<string, unknown>;
}

export async function listTunnels(): Promise<CfTunnel[]> {
  const acct = process.env.CLOUDFLARE_ACCOUNT_ID!;
  return cf<CfTunnel[]>(`/accounts/${acct}/cfd_tunnel?is_deleted=false&per_page=50`);
}

export interface CreatedTunnel extends CfTunnel {
  // Cloudflare returns a `token` field on creation that can be passed to
  // `cloudflared tunnel run --token <token>`.
  token?: string;
}

export async function createTunnel(name: string): Promise<CreatedTunnel> {
  const acct = process.env.CLOUDFLARE_ACCOUNT_ID!;
  // Generate a 32-byte tunnel-secret (Cloudflare requires base64-encoded raw bytes)
  const secret = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');
  const tunnel = await cf<CreatedTunnel>(`/accounts/${acct}/cfd_tunnel`, {
    method: 'POST',
    body: JSON.stringify({ name, tunnel_secret: secret, config_src: 'cloudflare' }),
  });
  // Pull token in a second call so the UI can copy/paste it for `cloudflared tunnel run --token`.
  try {
    const token = await cf<string>(`/accounts/${acct}/cfd_tunnel/${tunnel.id}/token`);
    return { ...tunnel, token };
  } catch {
    return tunnel;
  }
}

export async function deleteTunnel(id: string): Promise<void> {
  const acct = process.env.CLOUDFLARE_ACCOUNT_ID!;
  await cf<unknown>(`/accounts/${acct}/cfd_tunnel/${id}`, { method: 'DELETE' });
}

export async function getTunnelToken(id: string): Promise<string> {
  const acct = process.env.CLOUDFLARE_ACCOUNT_ID!;
  return cf<string>(`/accounts/${acct}/cfd_tunnel/${id}/token`);
}

// ---------- Tunnel configuration (ingress rules) ----------

export interface IngressRule {
  hostname?: string;
  service: string;
  path?: string;
  originRequest?: Record<string, unknown>;
}

export interface TunnelConfig {
  tunnel_id?: string;
  version?: number;
  config?: {
    ingress?: IngressRule[];
    'warp-routing'?: { enabled: boolean };
    originRequest?: Record<string, unknown>;
  };
}

export async function getTunnelConfig(id: string): Promise<TunnelConfig> {
  const acct = process.env.CLOUDFLARE_ACCOUNT_ID!;
  return cf<TunnelConfig>(`/accounts/${acct}/cfd_tunnel/${id}/configurations`);
}

export async function setTunnelConfig(id: string, ingress: IngressRule[]): Promise<TunnelConfig> {
  const acct = process.env.CLOUDFLARE_ACCOUNT_ID!;
  // Cloudflare requires a catch-all "http_status:404" rule at the end of the
  // ingress list — make sure it's there.
  const tail = ingress[ingress.length - 1];
  const fullIngress: IngressRule[] =
    tail && tail.service === 'http_status:404' ? ingress : [...ingress, { service: 'http_status:404' }];
  return cf<TunnelConfig>(`/accounts/${acct}/cfd_tunnel/${id}/configurations`, {
    method: 'PUT',
    body: JSON.stringify({ config: { ingress: fullIngress } }),
  });
}

// ---------- Zones / DNS routes ----------

export interface CfZone {
  id: string;
  name: string;
  status: string;
}

export async function listZones(): Promise<CfZone[]> {
  return cf<CfZone[]>(`/zones?per_page=50`);
}

export interface CfDnsRecord {
  id: string;
  name: string;
  type: string;
  content: string;
  proxied: boolean;
}

export async function findCnameForHostname(zoneId: string, hostname: string): Promise<CfDnsRecord | null> {
  const records = await cf<CfDnsRecord[]>(
    `/zones/${zoneId}/dns_records?type=CNAME&name=${encodeURIComponent(hostname)}`,
  );
  return records[0] ?? null;
}

export async function upsertTunnelCname(zoneId: string, hostname: string, tunnelId: string): Promise<void> {
  const target = `${tunnelId}.cfargotunnel.com`;
  const existing = await findCnameForHostname(zoneId, hostname);
  const body = JSON.stringify({
    type: 'CNAME',
    name: hostname,
    content: target,
    proxied: true,
    ttl: 1,
  });
  if (existing) {
    await cf<CfDnsRecord>(`/zones/${zoneId}/dns_records/${existing.id}`, { method: 'PUT', body });
  } else {
    await cf<CfDnsRecord>(`/zones/${zoneId}/dns_records`, { method: 'POST', body });
  }
}

export async function deleteCname(zoneId: string, hostname: string): Promise<void> {
  const existing = await findCnameForHostname(zoneId, hostname);
  if (existing) {
    await cf<unknown>(`/zones/${zoneId}/dns_records/${existing.id}`, { method: 'DELETE' });
  }
}

export function findZoneForHostname(zones: CfZone[], hostname: string): CfZone | null {
  // Pick the longest zone name that's a suffix of the hostname.
  const matches = zones
    .filter((z) => hostname === z.name || hostname.endsWith('.' + z.name))
    .sort((a, b) => b.name.length - a.name.length);
  return matches[0] ?? null;
}
