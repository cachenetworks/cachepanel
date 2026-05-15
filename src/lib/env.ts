import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  NEXTAUTH_URL: z.string().url(),
  NEXTAUTH_SECRET: z.string().min(16, 'NEXTAUTH_SECRET must be at least 16 chars'),
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_CLIENT_SECRET: z.string().min(1),
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
