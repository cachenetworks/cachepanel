import { prisma } from './prisma';
import { ConfigKeys, invalidateConfigCache } from './config';

/**
 * On first boot of v1.7+, seed the AppSetting `config.*` keys from any
 * matching env vars present at process start. Idempotent — if AppSetting
 * already has a value, env is ignored.
 *
 * Called from `server.js` after `app.prepare()`.
 *
 * Rejects obvious placeholder values (`changeme`, `xxx`, `<token>`, etc.)
 * so the setup wizard still fires for users whose .env was never filled in.
 */

const PLACEHOLDER_RE = /^(changeme|todo|xxx+|<.*>|your[-_]?(token|secret|key))$/i;

interface MigrationResult {
  migrated: string[];
  skippedExisting: string[];
  skippedPlaceholder: string[];
  skippedEmpty: string[];
}

export async function migrateConfigFromEnv(): Promise<MigrationResult> {
  const result: MigrationResult = {
    migrated: [],
    skippedExisting: [],
    skippedPlaceholder: [],
    skippedEmpty: [],
  };

  // Read every existing config.* key in one query so we don't N+1.
  const existingRows = await prisma.appSetting.findMany({
    where: { key: { startsWith: 'config.' } },
    select: { key: true, value: true },
  });
  const existing = new Map(existingRows.map((r) => [r.key, r.value]));

  for (const [key, def] of Object.entries(ConfigKeys)) {
    const dbKey = 'config.' + key;
    const envValue = process.env[def.env];

    if (existing.has(dbKey) && existing.get(dbKey) !== '') {
      result.skippedExisting.push(key);
      continue;
    }
    if (envValue === undefined || envValue === '') {
      result.skippedEmpty.push(key);
      continue;
    }
    if (PLACEHOLDER_RE.test(envValue)) {
      result.skippedPlaceholder.push(key);
      continue;
    }
    await prisma.appSetting.upsert({
      where: { key: dbKey },
      update: { value: envValue },
      create: { key: dbKey, value: envValue },
    });
    result.migrated.push(key);
  }

  if (result.migrated.length > 0) {
    invalidateConfigCache();
    try {
      const mod = await import('./config-snapshot');
      await mod.refreshConfigSnapshot();
    } catch {
      /* ignore */
    }
    console.log(
      `[config-migrate] Migrated ${result.migrated.length} setting(s) from .env to database:`,
    );
    for (const k of result.migrated) {
      console.log(`  · ${ConfigKeys[k as keyof typeof ConfigKeys].env}`);
    }
    console.log(
      '[config-migrate] You can safely remove those keys from .env after the next restart.',
    );
  }
  if (result.skippedPlaceholder.length > 0) {
    console.warn(
      `[config-migrate] ${result.skippedPlaceholder.length} setting(s) had placeholder values and were NOT migrated:`,
      result.skippedPlaceholder.join(', '),
    );
  }

  return result;
}
