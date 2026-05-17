import { prisma } from './prisma';

/**
 * Typed config layer that reads from `AppSetting` first, falls back to
 * `process.env` second. Falls back so existing `.env`-based installs from
 * v1.6 and earlier keep working unchanged while we migrate users onto the
 * DB-backed setup wizard.
 *
 * Boot-only env vars (DATABASE_URL, NEXTAUTH_URL, NEXTAUTH_SECRET, APP_PORT,
 * AUTH_TRUST_HOST, CP_SETUP_TOKEN) still live in `env.ts`. Everything else
 * goes here.
 *
 * Keys are namespaced `config.*` in AppSetting so they don't collide with
 * `theme:*`, `alerts.*`, `backup.*`, etc., that already live there.
 */

const NS = 'config.';

// One process-wide map hydrated on first read. Much cheaper than the old
// per-key 5s TTL when we're touching 20+ keys per request.
const cache = new Map<string, string>();
let hydrated = false;
let hydrating: Promise<void> | null = null;

async function hydrate(): Promise<void> {
  if (hydrated) return;
  if (hydrating) return hydrating;
  hydrating = (async () => {
    try {
      const rows = await prisma.appSetting.findMany({
        where: { key: { startsWith: NS } },
      });
      for (const r of rows) cache.set(r.key, r.value);
      hydrated = true;
    } finally {
      hydrating = null;
    }
  })();
  return hydrating;
}

export function invalidateConfigCache(): void {
  hydrated = false;
  cache.clear();
}

interface KeyDef {
  /** Env-var name to fall back to (legacy installs). */
  env: string;
  type: 'string' | 'bool' | 'csv' | 'int';
  default?: string;
  /** If true, never echoed back by the GET-all endpoint. */
  secret?: boolean;
}

// Exhaustive map of config keys. Anything not here goes through plain
// settings.ts (theme:*, alerts.*, backup.*, etc.).
export const ConfigKeys = {
  discord_client_id:         { env: 'DISCORD_CLIENT_ID',         type: 'string', default: '' },
  discord_client_secret:     { env: 'DISCORD_CLIENT_SECRET',     type: 'string', default: '', secret: true },
  discord_guild_id:          { env: 'DISCORD_GUILD_ID',          type: 'string', default: '' },
  discord_allowed_role_ids:  { env: 'DISCORD_ALLOWED_ROLE_IDS',  type: 'csv',    default: '' },
  discord_allowed_user_ids:  { env: 'DISCORD_ALLOWED_USER_IDS',  type: 'csv',    default: '' },

  admin_can_approve_users:   { env: 'ADMIN_CAN_APPROVE_USERS',   type: 'bool',   default: 'false' },

  allowed_file_roots:        { env: 'ALLOWED_FILE_ROOTS',        type: 'csv',    default: '' },
  allow_dotenv_access:       { env: 'ALLOW_DOTENV_ACCESS',       type: 'bool',   default: 'false' },

  terminal_enabled:          { env: 'TERMINAL_ENABLED',          type: 'bool',   default: 'true' },
  terminal_shell:            { env: 'TERMINAL_SHELL',            type: 'string', default: '/bin/bash' },
  terminal_user:             { env: 'TERMINAL_USER',             type: 'string', default: '' },
  terminal_start_dir:        { env: 'TERMINAL_START_DIR',        type: 'string', default: '/home/cache' },
  terminal_audit_commands:   { env: 'TERMINAL_AUDIT_COMMANDS',   type: 'bool',   default: 'false' },

  ssh_host:                  { env: 'SSH_HOST',                  type: 'string', default: '' },
  ssh_port:                  { env: 'SSH_PORT',                  type: 'int',    default: '22' },
  ssh_user:                  { env: 'SSH_USER',                  type: 'string', default: '' },
  ssh_key_path:              { env: 'SSH_KEY_PATH',              type: 'string', default: '' },
  ssh_known_hosts:           { env: 'SSH_KNOWN_HOSTS',           type: 'string', default: '' },

  ollama_host:               { env: 'OLLAMA_HOST',               type: 'string', default: 'http://host.docker.internal:11434' },
  ollama_model:              { env: 'OLLAMA_MODEL',              type: 'string', default: 'mistral' },

  cloudflare_api_token:      { env: 'CLOUDFLARE_API_TOKEN',      type: 'string', default: '', secret: true },
  cloudflare_account_id:     { env: 'CLOUDFLARE_ACCOUNT_ID',     type: 'string', default: '' },
} as const satisfies Record<string, KeyDef>;

export type ConfigKey = keyof typeof ConfigKeys;

type ResolvedType<K extends ConfigKey> =
  (typeof ConfigKeys)[K]['type'] extends 'bool' ? boolean
  : (typeof ConfigKeys)[K]['type'] extends 'int' ? number
  : (typeof ConfigKeys)[K]['type'] extends 'csv' ? string[]
  : string;

function coerce<K extends ConfigKey>(key: K, raw: string): ResolvedType<K> {
  const def = ConfigKeys[key];
  switch (def.type) {
    case 'bool':
      return (raw === 'true') as ResolvedType<K>;
    case 'int':
      return (Number.parseInt(raw, 10) || 0) as ResolvedType<K>;
    case 'csv':
      return raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean) as ResolvedType<K>;
    default:
      return raw as ResolvedType<K>;
  }
}

async function readRaw<K extends ConfigKey>(key: K): Promise<string> {
  await hydrate();
  const dbVal = cache.get(NS + key);
  if (dbVal !== undefined && dbVal !== '') return dbVal;
  // Fallback: env var (legacy install).
  const envVal = process.env[ConfigKeys[key].env];
  if (envVal !== undefined && envVal !== '') return envVal;
  return ConfigKeys[key].default ?? '';
}

export async function getConfig<K extends ConfigKey>(key: K): Promise<ResolvedType<K>> {
  return coerce(key, await readRaw(key));
}

export async function getConfigRaw<K extends ConfigKey>(key: K): Promise<string> {
  return readRaw(key);
}

export async function setConfig<K extends ConfigKey>(
  key: K,
  value: ResolvedType<K> | string,
): Promise<void> {
  const def = ConfigKeys[key];
  let stringValue: string;
  if (typeof value === 'string') {
    stringValue = value;
  } else if (def.type === 'bool') {
    stringValue = value ? 'true' : 'false';
  } else if (def.type === 'csv' && Array.isArray(value)) {
    stringValue = value.join(',');
  } else if (def.type === 'int') {
    stringValue = String(value);
  } else {
    stringValue = String(value);
  }
  await prisma.appSetting.upsert({
    where: { key: NS + key },
    update: { value: stringValue },
    create: { key: NS + key, value: stringValue },
  });
  cache.set(NS + key, stringValue);
  // Refresh the sync snapshot read by auth.ts so the Discord creds saved
  // by the setup wizard take effect on the next sign-in attempt without
  // a container restart. Lazy import = no circular dep at module load.
  try {
    const mod = await import('./config-snapshot');
    await mod.refreshConfigSnapshot();
  } catch {
    /* swallow — first-boot path may not have it loaded yet */
  }
}

export async function getManyConfig<K extends ConfigKey>(
  keys: K[],
): Promise<{ [P in K]: ResolvedType<P> }> {
  await hydrate();
  const out = {} as { [P in K]: ResolvedType<P> };
  for (const k of keys) {
    out[k] = coerce(k, await readRaw(k));
  }
  return out;
}

/**
 * Returns true if the panel has no Discord OAuth configured AND no users
 * yet — i.e. we need to drop the user into the setup wizard.
 */
export async function isSetupMode(): Promise<boolean> {
  const clientId = await readRaw('discord_client_id');
  const clientSecret = await readRaw('discord_client_secret');
  if (!clientId || !clientSecret) return true;
  try {
    const count = await prisma.user.count();
    return count === 0;
  } catch {
    // If we can't reach the DB, default to setup mode so the user is
    // pointed somewhere informative rather than a blank 500.
    return true;
  }
}
