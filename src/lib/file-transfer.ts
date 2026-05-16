import { spawn } from 'node:child_process';
import { prisma } from './prisma';
import { resolveSshSpec } from './servers';
import type { SshSpec } from './servers';

// Server-to-server file transfer. Uses tar over an SSH pipe — works on
// any modern Linux without rsync. For huge transfers (>1GB), users
// should still prefer rsync directly; this is for "move my configs"
// scale work, not bulk media migration.
//
// Architecture: we spawn TWO ssh processes from the panel container:
//   panel  --ssh-->  src host:  tar czf - <path>
//   panel  --ssh-->  dst host:  tar xzf - -C <dest>
// And pipe stdout of #1 into stdin of #2. Verifies with `find` count
// after copy. For 'move', deletes source after verified copy.

export class FileTransferError extends Error {
  constructor(message: string, public httpStatus = 500) {
    super(message);
    this.name = 'FileTransferError';
  }
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function sshArgs(spec: SshSpec): string[] {
  const args = [
    '-i',
    spec.keyPath,
    '-o',
    'BatchMode=yes',
    '-o',
    'StrictHostKeyChecking=yes',
    '-o',
    'PasswordAuthentication=no',
    '-p',
    String(spec.port),
  ];
  if (spec.knownHosts) {
    args.push('-o', `UserKnownHostsFile=${spec.knownHosts}`);
  }
  args.push(`${spec.user}@${spec.host}`);
  return args;
}

async function runSshCommand(spec: SshSpec, cmd: string, timeoutMs = 60_000): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn('ssh', [...sshArgs(spec), cmd], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: killed ? 124 : code ?? -1, stdout, stderr });
    });
  });
}

async function resolveSpec(serverId: string, userId: string): Promise<SshSpec> {
  const server = await prisma.server.findUnique({ where: { id: serverId } });
  if (!server) throw new FileTransferError(`Server not found: ${serverId}`, 404);
  return resolveSshSpec(server, userId);
}

export interface TransferOptions {
  sourceServerId: string;
  sourcePath: string;
  destServerId: string;
  destPath: string;
  userId: string;
  mode: 'copy' | 'move';
}

export interface TransferResult {
  ok: boolean;
  bytesTransferred: number;
  sourceFileCount: number;
  destFileCount: number;
  durationMs: number;
  mode: 'copy' | 'move';
}

export async function transferFiles(opts: TransferOptions): Promise<TransferResult> {
  const start = Date.now();

  if (opts.sourceServerId === opts.destServerId && opts.sourcePath === opts.destPath) {
    throw new FileTransferError('Source and destination are identical', 400);
  }
  // Safety: never let users transfer into '/' or empty paths.
  if (!opts.sourcePath.startsWith('/') || !opts.destPath.startsWith('/')) {
    throw new FileTransferError('Paths must be absolute', 400);
  }
  if (opts.sourcePath === '/' || opts.destPath === '/') {
    throw new FileTransferError("Refusing to operate on '/'", 400);
  }

  const srcSpec = await resolveSpec(opts.sourceServerId, opts.userId);
  const dstSpec = await resolveSpec(opts.destServerId, opts.userId);

  // Confirm source exists + count files for verification.
  const srcCount = await runSshCommand(
    srcSpec,
    `find ${shellQuote(opts.sourcePath)} -mindepth 0 2>/dev/null | wc -l`,
    15_000,
  );
  if (srcCount.code !== 0) {
    throw new FileTransferError(`Source not reachable: ${srcCount.stderr.trim() || 'ssh failed'}`, 502);
  }
  const sourceFileCount = parseInt(srcCount.stdout.trim(), 10) || 0;
  if (sourceFileCount === 0) {
    throw new FileTransferError('Source path is empty or does not exist', 404);
  }

  // Make sure dest parent dir exists.
  const dstMk = await runSshCommand(
    dstSpec,
    `mkdir -p ${shellQuote(opts.destPath)}`,
    15_000,
  );
  if (dstMk.code !== 0) {
    throw new FileTransferError(`Cannot create dest dir: ${dstMk.stderr.trim()}`, 502);
  }

  // Stream tar from src into tar on dst.
  // `-C <parent>` then `<basename>` so the dest extract preserves the
  // top-level name correctly.
  const lastSep = opts.sourcePath.lastIndexOf('/');
  const srcParent = opts.sourcePath.slice(0, lastSep) || '/';
  const srcBase = opts.sourcePath.slice(lastSep + 1) || '.';

  const tarCmd = `tar czf - -C ${shellQuote(srcParent)} ${shellQuote(srcBase)}`;
  const untarCmd = `tar xzf - -C ${shellQuote(opts.destPath)}`;

  const result = await new Promise<{ code: number; stderr: string; bytes: number }>((resolve) => {
    const srcChild = spawn('ssh', [...sshArgs(srcSpec), tarCmd], { stdio: ['ignore', 'pipe', 'pipe'] });
    const dstChild = spawn('ssh', [...sshArgs(dstSpec), untarCmd], { stdio: ['pipe', 'pipe', 'pipe'] });
    let bytes = 0;
    let srcErr = '';
    let dstErr = '';
    srcChild.stdout.on('data', (chunk) => {
      bytes += chunk.length;
      try {
        dstChild.stdin.write(chunk);
      } catch {
        /* destination might've closed */
      }
    });
    srcChild.stderr.on('data', (d) => {
      srcErr += d.toString();
    });
    dstChild.stderr.on('data', (d) => {
      dstErr += d.toString();
    });
    srcChild.on('close', () => {
      try {
        dstChild.stdin.end();
      } catch {
        /* ignore */
      }
    });
    const timer = setTimeout(() => {
      srcChild.kill('SIGKILL');
      dstChild.kill('SIGKILL');
    }, 30 * 60_000); // 30 min hard cap
    dstChild.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        code: code ?? -1,
        stderr: `${srcErr}\n${dstErr}`.trim(),
        bytes,
      });
    });
  });

  if (result.code !== 0) {
    throw new FileTransferError(`tar pipeline failed: ${result.stderr.slice(0, 500)}`, 500);
  }

  // Verify by file count on destination.
  const destFinalPath = `${opts.destPath}/${srcBase}`;
  const dstCount = await runSshCommand(
    dstSpec,
    `find ${shellQuote(destFinalPath)} -mindepth 0 2>/dev/null | wc -l`,
    15_000,
  );
  const destFileCount = parseInt(dstCount.stdout.trim(), 10) || 0;

  if (destFileCount < sourceFileCount) {
    throw new FileTransferError(
      `Verification failed: source had ${sourceFileCount} entries, destination has ${destFileCount}`,
      500,
    );
  }

  // For 'move', delete the source.
  if (opts.mode === 'move') {
    const del = await runSshCommand(srcSpec, `rm -rf ${shellQuote(opts.sourcePath)}`, 60_000);
    if (del.code !== 0) {
      // Copy succeeded, delete failed — surface as a warning, not a hard error.
      console.warn('[file-transfer] move: copy ok but delete failed', del.stderr);
    }
  }

  return {
    ok: true,
    bytesTransferred: result.bytes,
    sourceFileCount,
    destFileCount,
    durationMs: Date.now() - start,
    mode: opts.mode,
  };
}
