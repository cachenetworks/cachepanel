// One-shot OS detection for managed hosts. Run a probe command that prints a
// different thing on Linux vs Windows, parse the result, persist to the
// Server.os column so we never have to ask again. Falls back to "unknown"
// on probe failure (the next request retries automatically).

import type { Server } from '@prisma/client';
import { spawn } from 'node:child_process';
import { prisma } from './prisma';
import { resolveSshSpec, sshArgs } from './servers';
import type { RemoteOs } from './host-adapter';

// Probe: `uname -s 2>/dev/null && exit 0 || ver`.
// - Linux/macOS: `uname -s` prints "Linux" / "Darwin" and exits 0; the
//   second half never runs.
// - Windows OpenSSH default shell: `uname` is missing, the OR runs `ver`
//   which prints "Microsoft Windows [Version X.Y.Z]".
//
// One round trip. No PowerShell needed — works against the default shell
// OpenSSH-on-Windows assigns new sessions (cmd.exe).
const PROBE = `uname -s 2>/dev/null && exit 0 || ver`;

export function classifyOs(probeOutput: string): RemoteOs {
  const t = probeOutput.trim();
  if (!t) return 'unknown';
  if (/^Linux\b/i.test(t)) return 'linux';
  if (/^Darwin\b/i.test(t)) return 'linux'; // treat macOS as Linux-adapter-compatible
  if (/Microsoft Windows|Windows \[Version/i.test(t)) return 'windows';
  if (/^FreeBSD|^OpenBSD|^NetBSD/i.test(t)) return 'linux'; // BSDs work with the POSIX path
  return 'unknown';
}

/**
 * Detect the OS for a Server by running PROBE over SSH. Cheap (one round
 * trip, no auth-free fallback). Caller is responsible for handling the
 * "unknown" result — typically by retrying on the next user-driven action.
 */
export async function detectOs(server: Server, userId?: string | null): Promise<RemoteOs> {
  const spec = await resolveSshSpec(server, userId ?? null);
  const args = sshArgs(spec, []);
  args.push(PROBE);
  const out = await new Promise<{ stdout: string; code: number }>((resolve) => {
    const child = spawn('ssh', args);
    let stdout = '';
    const t = setTimeout(() => child.kill('SIGKILL'), 6000);
    child.stdout.on('data', (b) => (stdout += b.toString()));
    child.stderr.on('data', () => undefined);
    child.on('close', (code) => {
      clearTimeout(t);
      resolve({ stdout, code: code ?? -1 });
    });
    child.on('error', () => {
      clearTimeout(t);
      resolve({ stdout: '', code: -1 });
    });
  });
  if (out.code !== 0) return 'unknown';
  return classifyOs(out.stdout);
}

/**
 * Detect + persist. Idempotent: re-runs probe if stored os is "unknown",
 * otherwise trusts the stored value. Callers can pass `force: true` to
 * re-probe (e.g. when the admin changed something on the host).
 */
export async function detectAndPersistOs(
  server: Server,
  opts: { userId?: string | null; force?: boolean } = {},
): Promise<RemoteOs> {
  if (!opts.force && server.os && server.os !== 'unknown') {
    return server.os as RemoteOs;
  }
  const os = await detectOs(server, opts.userId);
  if (os !== 'unknown' && os !== server.os) {
    await prisma.server.update({ where: { id: server.id }, data: { os } });
  }
  return os;
}
