import { promises as fs } from 'node:fs';
import { createReadStream, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { getSetting } from './settings';

// MVP backup: tar+gzip of the panel's persistent data (SQLite DB, secrets,
// secrets-users, secrets-servers) into /app/data/backups/.
//
// Restore is intentionally manual in v1.5 — un-tar the file and restart the
// container. Automating restore would mean stopping the running app from
// within itself, which is operationally messy.

const DATA_DIR = process.env.CP_DATA_DIR ?? '/app/data';
const BACKUPS_DIR = join(DATA_DIR, 'backups');

export interface BackupInfo {
  filename: string;
  size: number;
  createdAt: string;
}

async function ensureBackupsDir() {
  await fs.mkdir(BACKUPS_DIR, { recursive: true });
}

export async function listBackups(): Promise<BackupInfo[]> {
  try {
    await ensureBackupsDir();
    const entries = await fs.readdir(BACKUPS_DIR, { withFileTypes: true });
    const files = entries.filter((e) => e.isFile() && e.name.endsWith('.tar.gz'));
    const out: BackupInfo[] = [];
    for (const f of files) {
      try {
        const s = statSync(join(BACKUPS_DIR, f.name));
        out.push({ filename: f.name, size: s.size, createdAt: s.mtime.toISOString() });
      } catch {
        /* skip */
      }
    }
    return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  } catch (err) {
    console.error('[backup] list failed', err);
    return [];
  }
}

export async function createBackup(): Promise<BackupInfo> {
  await ensureBackupsDir();
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `cachepanel-${ts}.tar.gz`;
  const outPath = join(BACKUPS_DIR, filename);

  // Tar everything under DATA_DIR EXCEPT the backups directory itself
  // (otherwise the backup balloons recursively).
  const args = [
    'czf',
    outPath,
    '-C',
    DATA_DIR,
    '--exclude',
    'backups',
    '.',
  ];

  await new Promise<void>((resolve, reject) => {
    const child = spawn('tar', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`tar exited ${code}: ${stderr.slice(0, 500)}`));
    });
  });

  const s = statSync(outPath);
  return { filename, size: s.size, createdAt: s.mtime.toISOString() };
}

export async function deleteBackup(filename: string): Promise<void> {
  // Hard reject anything but plain .tar.gz filenames — no path traversal.
  if (!/^[a-zA-Z0-9._-]+\.tar\.gz$/.test(filename)) {
    throw new Error('Invalid backup filename');
  }
  const p = resolve(BACKUPS_DIR, filename);
  if (!p.startsWith(resolve(BACKUPS_DIR))) throw new Error('Path traversal blocked');
  await fs.unlink(p);
}

export function getBackupStream(filename: string) {
  if (!/^[a-zA-Z0-9._-]+\.tar\.gz$/.test(filename)) {
    throw new Error('Invalid backup filename');
  }
  const p = resolve(BACKUPS_DIR, filename);
  if (!p.startsWith(resolve(BACKUPS_DIR))) throw new Error('Path traversal blocked');
  return createReadStream(p);
}

export async function getBackupBuffer(filename: string): Promise<Buffer> {
  if (!/^[a-zA-Z0-9._-]+\.tar\.gz$/.test(filename)) {
    throw new Error('Invalid backup filename');
  }
  const p = resolve(BACKUPS_DIR, filename);
  if (!p.startsWith(resolve(BACKUPS_DIR))) throw new Error('Path traversal blocked');
  return fs.readFile(p);
}

export async function getBackupSize(filename: string): Promise<number> {
  if (!/^[a-zA-Z0-9._-]+\.tar\.gz$/.test(filename)) {
    throw new Error('Invalid backup filename');
  }
  const p = resolve(BACKUPS_DIR, filename);
  if (!p.startsWith(resolve(BACKUPS_DIR))) throw new Error('Path traversal blocked');
  const s = statSync(p);
  return s.size;
}

// ---- S3-compatible cloud destination ----
// Settings keys:
//   backup.s3_endpoint      - "https://s3.us-east-1.amazonaws.com" or "https://<accountid>.r2.cloudflarestorage.com"
//   backup.s3_region        - "us-east-1" (Cloudflare R2 expects "auto")
//   backup.s3_bucket        - bucket name
//   backup.s3_access_key    - access key id
//   backup.s3_secret_key    - secret access key
//   backup.s3_prefix        - optional path prefix in the bucket (e.g. "cachepanel/")

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  prefix: string;
}

export async function getS3Config(): Promise<S3Config | null> {
  const endpoint = await getSetting('backup.s3_endpoint');
  const region = await getSetting('backup.s3_region');
  const bucket = await getSetting('backup.s3_bucket');
  const accessKey = await getSetting('backup.s3_access_key');
  const secretKey = await getSetting('backup.s3_secret_key');
  if (!endpoint || !bucket || !accessKey || !secretKey) return null;
  const prefix = (await getSetting('backup.s3_prefix')) ?? '';
  return {
    endpoint,
    region: region || 'auto',
    bucket,
    accessKey,
    secretKey,
    prefix,
  };
}

export async function uploadBackupToS3(filename: string): Promise<{ key: string; size: number }> {
  const cfg = await getS3Config();
  if (!cfg) throw new Error('S3 not configured');
  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const client = new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region,
    credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey },
    forcePathStyle: true,
  });
  const buf = await getBackupBuffer(filename);
  const key = `${cfg.prefix}${filename}`;
  await client.send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
      Body: buf,
      ContentType: 'application/gzip',
    }),
  );
  return { key, size: buf.length };
}

