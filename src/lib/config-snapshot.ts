import { prisma } from './prisma';
import { ConfigKeys } from './config';

/**
 * Sync snapshot of AppSetting `config.*` values, hydrated once at startup
 * and refreshable on demand. Exists so `auth.ts` (which builds NextAuth
 * options synchronously) can read Discord creds from the DB without
 * await-ing every time.
 *
 * Reads env on cold-start as a baseline; the first DB hydration overwrites
 * any matching keys; setConfig() callers can `refreshConfigSnapshot()` to
 * pick up writes immediately.
 */

const snapshot = new Map<string, string>();
let primed = false;
let priming: Promise<void> | null = null;

function envBaseline() {
  for (const [key, def] of Object.entries(ConfigKeys)) {
    const v = process.env[def.env];
    if (v !== undefined && v !== '') snapshot.set(key, v);
  }
}

async function loadFromDb() {
  try {
    const rows = await prisma.appSetting.findMany({
      where: { key: { startsWith: 'config.' } },
      select: { key: true, value: true },
    });
    for (const r of rows) {
      const key = r.key.slice('config.'.length);
      if (r.value !== '') snapshot.set(key, r.value);
    }
  } catch {
    // Boot before DB ready — env baseline stays.
  }
}

export async function refreshConfigSnapshot(): Promise<void> {
  if (!primed) envBaseline();
  await loadFromDb();
  primed = true;
}

export function primeConfigSnapshot(): Promise<void> {
  if (primed) return Promise.resolve();
  if (priming) return priming;
  priming = (async () => {
    envBaseline();
    await loadFromDb();
    primed = true;
    priming = null;
  })();
  return priming;
}

export function readSnapshot(key: string, fallback = ''): string {
  if (!primed) envBaseline(); // Sync fallback if first call beats hydration
  return snapshot.get(key) ?? fallback;
}
