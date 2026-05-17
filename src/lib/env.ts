import { z } from 'zod';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Auto-load .env if the runtime didn't (e.g. Pterodactyl egg whose startup
// command forgot to `set -a; . ./.env`). Idempotent: only sets vars that
// aren't already present in process.env, so a real shell export still wins.
function loadDotEnvOnce() {
  if ((globalThis as { __cp_env_loaded?: boolean }).__cp_env_loaded) return;
  (globalThis as { __cp_env_loaded?: boolean }).__cp_env_loaded = true;

  const candidates = [
    process.env.DOTENV_PATH,
    resolve(process.cwd(), '.env'),
  ].filter((p): p is string => Boolean(p));

  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      const content = readFileSync(path, 'utf8');
      for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const eq = line.indexOf('=');
        if (eq === -1) continue;
        const key = line.slice(0, eq).trim();
        if (!key || key in process.env) continue;
        let value = line.slice(eq + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        process.env[key] = value;
      }
      return;
    } catch {
      // Ignore — fall through to schema validation, which will surface a
      // clearer "VAR is required" error than a parse failure.
    }
  }
}

loadDotEnvOnce();

const schema = z.object({
  // ---- Boot-required (must be set in .env before the container starts) ---
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  NEXTAUTH_URL: z.string().url(),
  NEXTAUTH_SECRET: z.string().min(16, 'NEXTAUTH_SECRET must be at least 16 chars'),

  // ---- Optional override for the v1.7 first-run setup token --------------
  // If unset, server.js generates a random one and persists it in AppSetting.
  CP_SETUP_TOKEN: z.string().optional().default(''),

  // ---- LEGACY env-only path (config.ts now reads these via AppSetting first,
  //      with env fallback). Marked optional so fresh installs can boot
  //      without Discord creds and land in the /setup wizard. -------------
  DISCORD_CLIENT_ID: z.string().optional().default(''),
  DISCORD_CLIENT_SECRET: z.string().optional().default(''),
  DISCORD_GUILD_ID: z.string().optional().default(''),
  DISCORD_ALLOWED_ROLE_IDS: z.string().optional().default(''),
  DISCORD_ALLOWED_USER_IDS: z.string().optional().default(''),
  ADMIN_CAN_APPROVE_USERS: z
    .string()
    .optional()
    .default('false')
    .transform((v) => v === 'true'),
  ALLOWED_FILE_ROOTS: z
    .string()
    .optional()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ALLOW_DOTENV_ACCESS: z
    .string()
    .optional()
    .default('false')
    .transform((v) => v === 'true'),
  TERMINAL_ENABLED: z
    .string()
    .optional()
    .default('true')
    .transform((v) => v === 'true'),
  TERMINAL_SHELL: z.string().optional().default('/bin/bash'),
  TERMINAL_USER: z.string().optional().default(''),
  TERMINAL_START_DIR: z.string().optional().default('/home/cache'),
  TERMINAL_AUDIT_COMMANDS: z
    .string()
    .optional()
    .default('false')
    .transform((v) => v === 'true'),
  SSH_HOST: z.string().optional().default(''),
  SSH_PORT: z.string().optional().default('22'),
  SSH_USER: z.string().optional().default(''),
  SSH_KEY_PATH: z.string().optional().default(''),
  SSH_KNOWN_HOSTS: z.string().optional().default(''),
  APP_PORT: z
    .string()
    .optional()
    .default('8992')
    .transform((v) => Number.parseInt(v, 10)),
});

type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

export function getAllowedRoles(): string[] {
  const env = getEnv();
  return env.DISCORD_ALLOWED_ROLE_IDS.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function getAllowedUserIds(): string[] {
  const env = getEnv();
  return env.DISCORD_ALLOWED_USER_IDS.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
