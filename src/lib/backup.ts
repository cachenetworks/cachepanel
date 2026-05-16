import { promises as fs } from 'node:fs';
import { createReadStream, createWriteStream, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

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

export async function getBackupSize(filename: string): Promise<number> {
  if (!/^[a-zA-Z0-9._-]+\.tar\.gz$/.test(filename)) {
    throw new Error('Invalid backup filename');
  }
  const p = resolve(BACKUPS_DIR, filename);
  if (!p.startsWith(resolve(BACKUPS_DIR))) throw new Error('Path traversal blocked');
  const s = statSync(p);
  return s.size;
}

// Quick helper — silence unused-import warning for createWriteStream if we
// add S3 streaming in v1.6.
export const _createWriteStream = createWriteStream;
