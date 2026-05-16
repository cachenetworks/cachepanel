import { randomBytes } from 'node:crypto';
import { prisma } from './prisma';
import { runOnHost } from './host-probe';
import { hostWriteText } from './host-fs';
import { getCatalogApp, type CatalogApp, type AppVar } from '@/data/app-catalog';

const APPS_ROOT = process.env.APPS_ROOT ?? '/opt/cachepanel/apps';

export class AppInstallError extends Error {
  constructor(message: string, public code: string, public httpStatus = 400) {
    super(message);
    this.name = 'AppInstallError';
  }
}

function generateSecret(): string {
  // 32 chars, URL-safe.
  return randomBytes(24).toString('base64url');
}

function shellQuote(s: string): string {
  // Single-quote and escape embedded single quotes the POSIX way.
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
}

function validateVars(
  catalog: CatalogApp,
  input: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const v of catalog.variables) {
    let value = input[v.name];
    if ((value === undefined || value === '') && v.default !== undefined) value = v.default;
    if ((value === undefined || value === '') && v.required) {
      // Auto-generate passwords if required + secret + missing.
      if (v.type === 'password' && v.secret) {
        value = generateSecret();
      } else {
        throw new AppInstallError(`Missing required variable: ${v.name}`, 'VAR_REQUIRED');
      }
    }
    if (value === undefined) value = '';

    // Per-type sanity checks. Defense in depth — the UI also validates.
    if (v.type === 'port') {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1 || n > 65535) {
        throw new AppInstallError(`${v.name} must be a port (1-65535)`, 'VAR_INVALID');
      }
    }
    if (v.type === 'domain' && value && !/^https?:\/\/[^\s]+$/.test(value)) {
      throw new AppInstallError(`${v.name} must be a full URL including https://`, 'VAR_INVALID');
    }
    // Reject characters that would break the YAML quoting or shell.
    if (typeof value === 'string' && /["`$\\\n]/.test(value)) {
      throw new AppInstallError(
        `${v.name} contains a disallowed character (one of: " \` $ \\ newline)`,
        'VAR_INVALID',
      );
    }
    out[v.name] = String(value);
  }
  return out;
}

async function preflightPortConflict(serverId: string, port: number): Promise<boolean> {
  const res = await runOnHost(
    `ss -tlnH 2>/dev/null | awk '{print $4}' | awk -F: '{print $NF}' | grep -wq '${port}' && echo busy || echo free`,
    { serverId, timeoutMs: 8000 },
  );
  return res.stdout.includes('busy');
}

function extractPortsFromVars(catalog: CatalogApp, vars: Record<string, string>) {
  // Conservative: treat any var named `PORT` as the public port and pair it
  // with the catalog default's container port (assumed equal unless template
  // does mapping). Future versions could parse the rendered compose.
  const ports: Array<{ public: number; container: number }> = [];
  if (vars.PORT) {
    ports.push({ public: Number(vars.PORT), container: Number(vars.PORT) });
  }
  return ports;
}

export interface InstallOptions {
  serverId: string;
  slug: string;
  variables: Record<string, string>;
  installedById?: string;
}

export interface InstallResult {
  appId: string;
  slug: string;
  status: string;
  hint?: string;
}

export async function installApp(opts: InstallOptions): Promise<InstallResult> {
  const catalog = getCatalogApp(opts.slug);
  if (!catalog) throw new AppInstallError('Unknown app', 'UNKNOWN_APP', 404);

  // One install per (server, slug) in v1.
  const existing = await prisma.installedApp.findUnique({
    where: { serverId_slug: { serverId: opts.serverId, slug: opts.slug } },
  });
  if (existing) {
    throw new AppInstallError(
      `${catalog.name} is already installed on this server`,
      'ALREADY_INSTALLED',
      409,
    );
  }

  const vars = validateVars(catalog, opts.variables);
  const publicPort = Number(vars.PORT ?? catalog.defaultPort);

  if (await preflightPortConflict(opts.serverId, publicPort)) {
    throw new AppInstallError(
      `Port ${publicPort} is already in use on the target server. Pick another.`,
      'PORT_BUSY',
      409,
    );
  }

  const compose = renderTemplate(catalog.composeTemplate, vars);
  const appDir = `${APPS_ROOT}/${catalog.slug}`;
  const composePath = `${appDir}/docker-compose.yml`;

  // Create directory structure on the host.
  const mkdir = await runOnHost(`mkdir -p ${shellQuote(appDir)} && chmod 750 ${shellQuote(appDir)}`, {
    serverId: opts.serverId,
    timeoutMs: 10000,
  });
  if (mkdir.code !== 0) {
    throw new AppInstallError(
      `Failed to create ${appDir}: ${mkdir.stderr.trim() || 'unknown error'}`,
      'MKDIR_FAILED',
      500,
    );
  }

  const wrote = await hostWriteText(composePath, compose, { serverId: opts.serverId });
  if (!wrote) {
    throw new AppInstallError('Failed to write docker-compose.yml to host', 'WRITE_FAILED', 500);
  }

  // Persist *before* docker compose up so a crash mid-install is still visible.
  const row = await prisma.installedApp.create({
    data: {
      serverId: opts.serverId,
      slug: catalog.slug,
      name: catalog.name,
      status: 'installing',
      variables: JSON.stringify(vars),
      composeYaml: compose,
      ports: JSON.stringify(extractPortsFromVars(catalog, vars)),
      imageTag: catalog.latestImage,
      installedById: opts.installedById,
    },
  });

  // Pull + up.
  const up = await runOnHost(
    `cd ${shellQuote(appDir)} && docker compose pull && docker compose up -d`,
    { serverId: opts.serverId, timeoutMs: 5 * 60_000 },
  );
  if (up.code !== 0) {
    await prisma.installedApp.update({
      where: { id: row.id },
      data: { status: 'failed' },
    });
    throw new AppInstallError(
      `docker compose up failed: ${up.stderr.trim().slice(0, 500) || 'unknown error'}`,
      'COMPOSE_FAILED',
      500,
    );
  }

  await prisma.installedApp.update({
    where: { id: row.id },
    data: { status: 'running' },
  });

  return { appId: row.id, slug: catalog.slug, status: 'running' };
}

export async function uninstallApp(appId: string): Promise<void> {
  const row = await prisma.installedApp.findUnique({ where: { id: appId } });
  if (!row) throw new AppInstallError('Not found', 'NOT_FOUND', 404);

  const appDir = `${APPS_ROOT}/${row.slug}`;
  await prisma.installedApp.update({ where: { id: row.id }, data: { status: 'removing' } });

  // docker compose down brings everything offline. We then nuke the dir so
  // re-install gets a clean slate. Volumes inside ./data ARE removed — v1
  // accepts the data loss; a future "uninstall but keep data" option can
  // skip the rm -rf.
  const cmd = `cd ${shellQuote(appDir)} 2>/dev/null && docker compose down -v 2>&1; rm -rf ${shellQuote(appDir)}`;
  await runOnHost(cmd, { serverId: row.serverId, timeoutMs: 2 * 60_000 });

  await prisma.installedApp.delete({ where: { id: row.id } });
}

export async function startApp(appId: string): Promise<void> {
  const row = await prisma.installedApp.findUnique({ where: { id: appId } });
  if (!row) throw new AppInstallError('Not found', 'NOT_FOUND', 404);
  const appDir = `${APPS_ROOT}/${row.slug}`;
  const res = await runOnHost(`cd ${shellQuote(appDir)} && docker compose up -d`, {
    serverId: row.serverId,
    timeoutMs: 2 * 60_000,
  });
  if (res.code !== 0) {
    throw new AppInstallError(res.stderr.trim() || 'docker compose up failed', 'COMPOSE_FAILED', 500);
  }
  await prisma.installedApp.update({ where: { id: row.id }, data: { status: 'running' } });
}

export async function stopApp(appId: string): Promise<void> {
  const row = await prisma.installedApp.findUnique({ where: { id: appId } });
  if (!row) throw new AppInstallError('Not found', 'NOT_FOUND', 404);
  const appDir = `${APPS_ROOT}/${row.slug}`;
  const res = await runOnHost(`cd ${shellQuote(appDir)} && docker compose stop`, {
    serverId: row.serverId,
    timeoutMs: 60_000,
  });
  if (res.code !== 0) {
    throw new AppInstallError(res.stderr.trim() || 'docker compose stop failed', 'COMPOSE_FAILED', 500);
  }
  await prisma.installedApp.update({ where: { id: row.id }, data: { status: 'stopped' } });
}

export async function getAppLogs(appId: string, lines = 200): Promise<string> {
  const row = await prisma.installedApp.findUnique({ where: { id: appId } });
  if (!row) throw new AppInstallError('Not found', 'NOT_FOUND', 404);
  const appDir = `${APPS_ROOT}/${row.slug}`;
  const res = await runOnHost(
    `cd ${shellQuote(appDir)} && docker compose logs --tail=${Math.max(1, Math.min(2000, lines))}`,
    { serverId: row.serverId, timeoutMs: 30_000 },
  );
  return res.stdout || res.stderr || '';
}

export async function updateApp(appId: string): Promise<void> {
  const row = await prisma.installedApp.findUnique({ where: { id: appId } });
  if (!row) throw new AppInstallError('Not found', 'NOT_FOUND', 404);
  const appDir = `${APPS_ROOT}/${row.slug}`;
  const res = await runOnHost(
    `cd ${shellQuote(appDir)} && docker compose pull && docker compose up -d`,
    { serverId: row.serverId, timeoutMs: 5 * 60_000 },
  );
  if (res.code !== 0) {
    throw new AppInstallError(res.stderr.trim() || 'compose update failed', 'COMPOSE_FAILED', 500);
  }
  await prisma.installedApp.update({
    where: { id: row.id },
    data: { status: 'running', hasUpdate: false, updatedAt: new Date() },
  });
}
