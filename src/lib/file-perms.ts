// Cross-platform file permission helpers. Linux uses POSIX modes;
// Windows uses ACLs which Node doesn't have a portable API for, so
// we shell out to icacls when needed.
//
// Used by anything that creates secrets / private keys / the SQLite
// database file so the panel-host install isn't world-readable.

import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';

const isWin = process.platform === 'win32';

/**
 * Make a file readable+writable by its owner only.
 * Linux: chmod 0600.
 * Windows: ACL grant only the current user (and SYSTEM) Full Control,
 *          remove inherited permissions.
 */
export async function ownerOnly(absPath: string): Promise<void> {
  if (!isWin) {
    await fs.chmod(absPath, 0o600).catch(() => undefined);
    return;
  }
  await icacls(absPath, [
    '/inheritance:r',
    `/grant:r`, `${process.env.USERNAME ?? 'CURRENT_USER'}:F`,
    `/grant:r`, 'SYSTEM:F',
  ]);
}

/** chmod 0700 / equivalent ACL on a directory. */
export async function ownerOnlyDir(absPath: string): Promise<void> {
  if (!isWin) {
    await fs.chmod(absPath, 0o700).catch(() => undefined);
    return;
  }
  await icacls(absPath, [
    '/inheritance:r',
    `/grant:r`, `${process.env.USERNAME ?? 'CURRENT_USER'}:(OI)(CI)F`,
    `/grant:r`, 'SYSTEM:(OI)(CI)F',
  ]);
}

function icacls(target: string, args: string[]): Promise<void> {
  return new Promise((resolve) => {
    const child = spawn('icacls.exe', [target, ...args], { windowsHide: true });
    // We resolve regardless of exit code — failure is non-fatal (the file
    // still works), and we don't want to crash the wizard's data-dir setup
    // because the user's permissions weren't tight enough to change ACLs.
    child.on('close', () => resolve());
    child.on('error', () => resolve());
  });
}
