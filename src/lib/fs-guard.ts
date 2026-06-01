import path from 'node:path';
import fs from 'node:fs/promises';
import { getEnv } from './env';

const SENSITIVE_FILENAMES = new Set([
  'shadow',
  'gshadow',
  'sudoers',
  'id_rsa',
  'id_ed25519',
  'id_ecdsa',
  'id_dsa',
  'authorized_keys',
]);

const SENSITIVE_DIRS = ['/etc/shadow', '/etc/sudoers.d', '/root/.ssh'];

export class FsGuardError extends Error {
  public readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

// Docker-volume host paths (e.g. /var/lib/docker/volumes/<name>/_data and
// per-container bind-mount sources) are auto-allowlisted on a per-request
// basis so users can browse container data from the file manager without
// having to widen ALLOWED_FILE_ROOTS to expose the whole host. Pre-fetched
// once per request and passed to resolveSafePath via the `extraRoots` opt.
//
// Lazy-loaded to avoid pulling docker-roots into pages that don't need it.
export async function getDockerVolumeRoots(): Promise<string[]> {
  try {
    const mod = await import('./docker-roots');
    const roots = await mod.listDockerRoots();
    // Dedupe — multiple containers can share the same source path.
    return Array.from(new Set(roots.map((r) => path.resolve(r.path))));
  } catch {
    return [];
  }
}

function normalizeAbsolute(p: string): string {
  if (!p) throw new FsGuardError('Path is required', 400);
  // Reject NUL bytes — node will reject anyway, but be explicit.
  if (p.includes('\0')) throw new FsGuardError('Invalid path', 400);
  const abs = path.resolve(p);
  return abs;
}

export function getAllowedRoots(): string[] {
  const env = getEnv();
  // If ALLOWED_FILE_ROOTS is empty we fall back to the whole filesystem ("/").
  // The sensitive-file blocklist below is still enforced.
  if (env.ALLOWED_FILE_ROOTS.length === 0) return ['/'];
  return env.ALLOWED_FILE_ROOTS.map((r) => path.resolve(r));
}

export function isUnrestricted(): boolean {
  const roots = getAllowedRoots();
  return roots.length === 1 && roots[0] === '/';
}

export interface ResolveOptions {
  isOwner: boolean;
  /** Permit reading/writing .env files (OWNER only when ALLOW_DOTENV_ACCESS=true). */
  allowDotenv?: boolean;
  /**
   * Extra allowed roots merged on top of getAllowedRoots(). Used to grant
   * access to docker-volume / bind-mount source paths surfaced by
   * getDockerVolumeRoots() without permanently widening the configured roots.
   */
  extraRoots?: string[];
}

export interface ResolvedPath {
  absolute: string;
  root: string;
  isSensitive: boolean;
  basename: string;
}

/**
 * Resolves a user-supplied path against allowed roots and rejects traversal
 * or access to clearly sensitive system files.
 */
export function resolveSafePath(input: string, opts: ResolveOptions): ResolvedPath {
  const env = getEnv();
  const abs = normalizeAbsolute(input);
  const baseRoots = getAllowedRoots();
  const extra = (opts.extraRoots ?? []).map((r) => path.resolve(r));
  const roots = [...baseRoots, ...extra];
  if (roots.length === 0) {
    throw new FsGuardError('No file roots are configured. Set ALLOWED_FILE_ROOTS.', 403);
  }
  // Special-case "/" so its prefix check (which would be "//") works.
  const root = roots.find((r) => {
    if (abs === r) return true;
    if (r === '/' || r === path.sep) return abs.startsWith('/') || abs.startsWith(path.sep);
    return abs.startsWith(r + path.sep);
  });
  if (!root) {
    throw new FsGuardError('Path is outside the allowed file roots.', 403);
  }
  const basename = path.basename(abs);
  if (SENSITIVE_DIRS.some((d) => abs === d || abs.startsWith(d + path.sep))) {
    throw new FsGuardError('Access to this path is blocked.', 403);
  }
  if (SENSITIVE_FILENAMES.has(basename)) {
    throw new FsGuardError('Access to this file is blocked.', 403);
  }
  const isDotenv = basename === '.env' || basename.startsWith('.env.');
  if (isDotenv) {
    const allowed = (opts.allowDotenv ?? env.ALLOW_DOTENV_ACCESS) && opts.isOwner;
    if (!allowed) {
      throw new FsGuardError('Access to .env files is disabled. OWNER may enable via ALLOW_DOTENV_ACCESS.', 403);
    }
  }
  const isSensitive =
    isDotenv ||
    basename.endsWith('.pem') ||
    basename.endsWith('.key') ||
    basename === 'credentials' ||
    basename === '.htpasswd';
  return { absolute: abs, root, isSensitive, basename };
}

/**
 * Pre-fetches docker-volume roots and resolves the path against the union of
 * the configured roots + those volume paths. Use this anywhere the user
 * might point at a container volume / bind mount from the file manager.
 */
export async function resolveSafePathWithDocker(
  input: string,
  opts: ResolveOptions,
): Promise<ResolvedPath> {
  const extraRoots = await getDockerVolumeRoots();
  return resolveSafePath(input, { ...opts, extraRoots: [...(opts.extraRoots ?? []), ...extraRoots] });
}

export async function statSafe(absolute: string) {
  try {
    return await fs.stat(absolute);
  } catch {
    return null;
  }
}

const TEXT_EXT = new Set([
  '.txt', '.md', '.markdown', '.json', '.yaml', '.yml', '.toml', '.ini', '.conf', '.cfg',
  '.log', '.csv', '.tsv', '.xml', '.html', '.htm', '.css', '.scss', '.sass', '.less',
  '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.py', '.rb', '.go', '.rs', '.java',
  '.kt', '.kts', '.swift', '.c', '.h', '.cc', '.cpp', '.hpp', '.cs', '.lua', '.php',
  '.sh', '.bash', '.zsh', '.fish', '.ps1', '.bat', '.cmd', '.sql', '.env', '.gitignore',
  '.dockerfile', '.dockerignore', '.editorconfig', '.prettierrc', '.eslintrc',
]);

export function isLikelyText(absolute: string): boolean {
  const base = path.basename(absolute).toLowerCase();
  if (base === 'dockerfile' || base === 'makefile' || base === 'license' || base === 'readme') return true;
  const ext = path.extname(absolute).toLowerCase();
  if (!ext) return false;
  return TEXT_EXT.has(ext);
}
