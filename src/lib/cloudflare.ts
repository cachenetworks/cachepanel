// Thin Cloudflare API client for the Tunnels page.
// Docs: https://developers.cloudflare.com/api/operations/cloudflare-tunnel-list-cloudflare-tunnels

import { getConfig } from './config';

const API = 'https://api.cloudflare.com/client/v4';

export interface CfCreds {
  token: string;
  accountId: string;
}

// Read creds from AppSetting (preferred) with env fallback for legacy
// installs. Empty strings → not-configured.
async function getCreds(): Promise<CfCreds> {
  const token = (await getConfig('cloudflare_api_token')) || process.env.CLOUDFLARE_API_TOKEN || '';
  const accountId = (await getConfig('cloudflare_account_id')) || process.env.CLOUDFLARE_ACCOUNT_ID || '';
  return { token, accountId };
}

export async function isCloudflareConfigured(): Promise<boolean> {
  const c = await getCreds();
  return !!(c.token && c.accountId);
}

interface CfEnvelope<T> {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  messages: unknown[];
  result: T;
  result_info?: { page: number; per_page: number; total_count: number };
}

// Internal: make a Cloudflare API call with explicit creds.
async function cfWith<T>(creds: CfCreds, path: string, init?: RequestInit): Promise<T> {
  if (!creds.token) {
    throw new Error('Cloudflare API token is not set.');
  }
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${creds.token}`,
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

// Default-creds variant — reads from config/env. Keep the short name so
// existing call sites don't change.
async function cf<T>(path: string, init?: RequestInit): Promise<T> {
  const creds = await getCreds();
  if (!creds.token || !creds.accountId) {
    throw new Error('Cloudflare is not configured. Set it under Settings → Cloudflare.');
  }
  return cfWith<T>(creds, path, init);
}

// ---------- Validate creds (used by /api/setup/validate/cloudflare) ----------

export interface CfValidateResult {
  ok: boolean;
  /** Plain-English message: success summary or actionable error. */
  message: string;
  /** Account name if we could fetch it. */
  account?: string;
  /** Missing scopes (token verified but lacks Tunnel:Edit or DNS:Edit). */
  missingScopes?: string[];
}

interface CfVerifyResp {
  id: string;
  status: string;
}

interface CfAccount {
  id: string;
  name: string;
}

export async function validateCloudflareCreds(token: string, accountId: string): Promise<CfValidateResult> {
  const creds: CfCreds = { token: token.trim(), accountId: accountId.trim() };
  if (!creds.token) return { ok: false, message: 'API token is empty.' };
  if (!creds.accountId) return { ok: false, message: 'Account ID is empty.' };
  if (!/^[0-9a-f]{32}$/i.test(creds.accountId)) {
    return {
      ok: false,
      message: 'Account ID looks malformed — should be 32 hex characters. Find it on the Cloudflare dashboard right sidebar.',
    };
  }

  // 1. Verify the token itself.
  try {
    const v = await cfWith<CfVerifyResp>(creds, '/user/tokens/verify');
    if (v.status !== 'active') {
      return { ok: false, message: `Token status is "${v.status}" — Cloudflare returned it inactive.` };
    }
  } catch (err) {
    return { ok: false, message: humanizeCfError(err, 'token verification') };
  }

  // 2. Confirm the token has access to the named account.
  let account: CfAccount;
  try {
    account = await cfWith<CfAccount>(creds, `/accounts/${creds.accountId}`);
  } catch {
    return {
      ok: false,
      message: `Token is valid, but can't access account ${creds.accountId}. Either the account ID is wrong, or the token wasn't issued with this account selected.`,
    };
  }

  // 3. Check tunnel-list scope (read implies the bare minimum; write is checked by attempting to list).
  const missingScopes: string[] = [];
  try {
    await cfWith<unknown>(creds, `/accounts/${creds.accountId}/cfd_tunnel?per_page=1`);
  } catch {
    missingScopes.push('Account · Cloudflare Tunnel · Read');
  }
  // 4. Zone access — needed to write DNS records pointing at the tunnel.
  try {
    await cfWith<unknown>(creds, `/zones?per_page=1`);
  } catch {
    missingScopes.push('Zone · DNS · Read');
  }

  if (missingScopes.length > 0) {
    return {
      ok: false,
      message: `Token works but is missing required scopes: ${missingScopes.join(' • ')}. Re-create the token with the Cloudflare "Edit Cloudflare Workers" template OR add these scopes manually.`,
      account: account.name,
      missingScopes,
    };
  }

  return {
    ok: true,
    message: `Connected to "${account.name}".`,
    account: account.name,
  };
}

function humanizeCfError(err: unknown, ctx: string): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/HTTP 401|Unauthorized|Invalid API/.test(msg)) {
    return `Token rejected by Cloudflare (${ctx}). Double-check you copied the entire token — they're long and easy to truncate.`;
  }
  if (/HTTP 403|Forbidden/.test(msg)) {
    return `Token is valid but doesn't have permission for ${ctx}. Re-create it with broader scopes.`;
  }
  if (/HTTP 404/.test(msg)) {
    return `Cloudflare returned 404 for ${ctx} — usually means the account ID is wrong.`;
  }
  return `${ctx} failed: ${msg}`;
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
  const acct = (await getCreds()).accountId;
  return cf<CfTunnel[]>(`/accounts/${acct}/cfd_tunnel?is_deleted=false&per_page=50`);
}

export interface CreatedTunnel extends CfTunnel {
  // Cloudflare returns a `token` field on creation that can be passed to
  // `cloudflared tunnel run --token <token>`.
  token?: string;
}

export async function createTunnel(name: string): Promise<CreatedTunnel> {
  const acct = (await getCreds()).accountId;
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
  const acct = (await getCreds()).accountId;
  await cf<unknown>(`/accounts/${acct}/cfd_tunnel/${id}`, { method: 'DELETE' });
}

export async function getTunnelToken(id: string): Promise<string> {
  const acct = (await getCreds()).accountId;
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
  const acct = (await getCreds()).accountId;
  return cf<TunnelConfig>(`/accounts/${acct}/cfd_tunnel/${id}/configurations`);
}

export async function setTunnelConfig(id: string, ingress: IngressRule[]): Promise<TunnelConfig> {
  const acct = (await getCreds()).accountId;
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
