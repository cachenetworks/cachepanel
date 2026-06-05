import { runOnHost } from './host-probe';
import { prisma } from './prisma';

// CachePanel self-updater.
//
// Three pieces:
//  1. detect — query GHCR for the latest image digest (no auth needed for
//     public package), compare to the currently-running image's digest.
//  2. status — also exposes the running version (from package.json) and the
//     newest release tag on GitHub (best-effort).
//  3. apply  — runs `docker compose pull && docker compose up -d cachepanel`
//     on the primary server over SSH. The container will be replaced; this
//     request will die mid-flight — that's normal.

const GHCR_BASE = 'https://ghcr.io/v2/cachenetworks/cachepanel';
const GH_RELEASES = 'https://api.github.com/repos/cachenetworks/cachepanel/releases/latest';

async function ghcrToken(): Promise<string | null> {
  try {
    const r = await fetch(
      `https://ghcr.io/token?scope=repository%3Acachenetworks%2Fcachepanel%3Apull&service=ghcr.io`,
    );
    if (!r.ok) return null;
    const j = (await r.json()) as { token?: string };
    return j.token ?? null;
  } catch {
    return null;
  }
}

export async function getRemoteDigest(tag = 'latest'): Promise<string | null> {
  const token = await ghcrToken();
  if (!token) return null;
  try {
    const r = await fetch(`${GHCR_BASE}/manifests/${tag}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json',
      },
    });
    if (!r.ok) return null;
    // The OCI digest is in the Docker-Content-Digest header.
    return r.headers.get('docker-content-digest');
  } catch {
    return null;
  }
}

export async function getLocalImageDigest(): Promise<string | null> {
  // Use the primary server (= our own host) to inspect this container's image.
  try {
    const primary = await prisma.server.findFirst({ where: { isPrimary: true } });
    if (!primary) return null;
    const containerName = process.env.CP_CONTAINER_NAME || 'cachepanel';
    const res = await runOnHost(
      `docker inspect --format '{{index .Image}}' ${containerName} 2>/dev/null`,
      { serverId: primary.id, timeoutMs: 5000 },
    );
    if (res.code !== 0) return null;
    return res.stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function getLatestReleaseTag(): Promise<string | null> {
  try {
    const r = await fetch(GH_RELEASES, { headers: { Accept: 'application/vnd.github+json' } });
    if (!r.ok) return null;
    const j = (await r.json()) as { tag_name?: string };
    return j.tag_name ?? null;
  } catch {
    return null;
  }
}

export interface UpdateStatus {
  current: { digest: string | null; version: string };
  remote: { digest: string | null; latestTag: string | null };
  updateAvailable: boolean;
  canApply: boolean;
  reason?: string;
}

export async function getUpdateStatus(): Promise<UpdateStatus> {
  const [localDigest, remoteDigest, latestTag] = await Promise.all([
    getLocalImageDigest(),
    getRemoteDigest('latest'),
    getLatestReleaseTag(),
  ]);
  const pkg = process.env.npm_package_version ?? '1.6.0';
  const updateAvailable =
    localDigest != null && remoteDigest != null && localDigest !== remoteDigest;
  const canApply = updateAvailable && localDigest != null;
  return {
    current: { digest: localDigest, version: pkg },
    remote: { digest: remoteDigest, latestTag },
    updateAvailable,
    canApply,
    reason: localDigest == null
      ? 'Could not read local container digest — is SSH-to-self provisioned?'
      : remoteDigest == null
        ? 'Could not query GHCR — network blocked or package private?'
        : undefined,
  };
}

export async function applyUpdate(): Promise<{ accepted: true; note: string }> {
  // v1.8.0: when the panel runs natively on Windows, there's no Docker
  // compose to bounce — we download the new release zip and restart the
  // Windows Service via PowerShell. (The Service restart re-execs node
  // against the freshly-unpacked files.)
  if (process.platform === 'win32') {
    const ps = `
$ErrorActionPreference='Stop'
$apiUrl = 'https://api.github.com/repos/cachenetworks/cachepanel/releases/latest'
$rel = Invoke-RestMethod -Uri $apiUrl -UseBasicParsing
$asset = $rel.assets | Where-Object { $_.name -like 'cachepanel-*-win.zip' } | Select-Object -First 1
if (-not $asset) { Write-Error 'no win zip in release'; exit 1 }
$zip = Join-Path $env:TEMP $asset.name
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zip -UseBasicParsing
$installDir = $env:CP_INSTALL_DIR
if (-not $installDir) { $installDir = 'C:\\Program Files\\CachePanel' }
Stop-Service CachePanel -ErrorAction SilentlyContinue
Expand-Archive -Path $zip -DestinationPath $installDir -Force
Push-Location $installDir
npm install --omit=dev --no-audit --no-fund | Out-Null
npx prisma migrate deploy | Out-Null
Pop-Location
Start-Service CachePanel
`;
    // Spawn a detached PowerShell so we return before the service restart
    // kills our own process. (Same fire-and-forget shape as Linux.)
    const { spawn } = await import('node:child_process');
    spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
      detached: true,
      stdio: 'ignore',
    }).unref();
    return {
      accepted: true,
      note: 'Update started. The Windows Service will restart in ~60s. Refresh the page after that.',
    };
  }

  const primary = await prisma.server.findFirst({ where: { isPrimary: true } });
  if (!primary) throw new Error('No primary server registered');
  const composeDir = process.env.CP_COMPOSE_DIR || '/opt/cachepanel';
  const cmd = `cd ${composeDir} && docker compose pull cachepanel && docker compose up -d --force-recreate cachepanel`;
  // Fire-and-forget: this will sever our own request mid-flight when the
  // container restarts. We return immediately so the UI sees a success
  // before the disconnect.
  void runOnHost(cmd, { serverId: primary.id, timeoutMs: 5 * 60_000 }).catch(() => {
    /* ignore — we're being replaced */
  });
  return {
    accepted: true,
    note: 'Update started. The panel will restart in ~30s. Refresh the page after that.',
  };
}
