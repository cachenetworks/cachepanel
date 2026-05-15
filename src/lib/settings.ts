import { prisma } from './prisma';
import { getEnv } from './env';

const cache = new Map<string, { value: string; cachedAt: number }>();
const TTL_MS = 5_000;

export async function getSetting(key: string): Promise<string | null> {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.cachedAt < TTL_MS) return cached.value;
  const row = await prisma.appSetting.findUnique({ where: { key } });
  if (!row) return null;
  cache.set(key, { value: row.value, cachedAt: Date.now() });
  return row.value;
}

export async function setSetting(key: string, value: string) {
  await prisma.appSetting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
  cache.set(key, { value, cachedAt: Date.now() });
}

export async function getBool(key: string, fallback: boolean): Promise<boolean> {
  const v = await getSetting(key);
  if (v == null) return fallback;
  return v === 'true';
}

export async function adminCanApproveUsers(): Promise<boolean> {
  const env = getEnv();
  return getBool('admin_can_approve_users', env.ADMIN_CAN_APPROVE_USERS);
}
