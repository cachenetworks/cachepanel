import { prisma } from './prisma';
import { runOnHost } from './host-probe';

// Sync the DB's view of cron jobs onto a server's crontab.
//
// Strategy: for the target server, read the current crontab, strip every line
// tagged `# cachepanel:*`, re-append all the DB rows (only the enabled ones),
// write back. Idempotent + non-destructive to user-edited lines.

const TAG_PREFIX = '# cachepanel:';

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function isReasonableCron(expr: string): boolean {
  // Five space-separated fields. We don't fully validate cron grammar
  // (would need a parser) — just reject anything obviously broken so
  // we don't trash the user's crontab.
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  return parts.every((p) => /^[0-9*,/\-]+$/.test(p));
}

export class ScheduleError extends Error {
  constructor(message: string, public httpStatus = 400) {
    super(message);
    this.name = 'ScheduleError';
  }
}

export async function syncCrontab(serverId: string): Promise<void> {
  const jobs = await prisma.scheduledJob.findMany({ where: { serverId } });
  // Read existing crontab; missing/empty crontab is fine.
  const cur = await runOnHost('crontab -l 2>/dev/null', { serverId, timeoutMs: 8000 });
  const existingLines = (cur.code === 0 ? cur.stdout : '').split('\n');
  // Drop any block that we own — two-line shape: tag line + cron line.
  const kept: string[] = [];
  for (let i = 0; i < existingLines.length; i++) {
    const line = existingLines[i] ?? '';
    if (line.startsWith(TAG_PREFIX)) {
      // Skip this tag line AND the next line (the actual cron entry).
      i++; // skip cron line too
      continue;
    }
    kept.push(line);
  }

  // Re-append our own block.
  const appended: string[] = [];
  for (const j of jobs) {
    if (!j.enabled) continue;
    if (!isReasonableCron(j.cronExpr)) continue;
    appended.push(`${TAG_PREFIX}${j.id}  ${j.name.replace(/[\r\n]/g, ' ').slice(0, 80)}`);
    appended.push(`${j.cronExpr} ${j.command.replace(/[\r\n]/g, ' ')}`);
  }

  const newCrontab = [...kept.filter((l) => l !== ''), ...appended].join('\n') + '\n';
  // Write via stdin: `printf %s '...' | crontab -`. Quoting is the risk;
  // use base64 to avoid all shell escaping.
  const b64 = Buffer.from(newCrontab, 'utf-8').toString('base64');
  const write = await runOnHost(
    `echo ${shellQuote(b64)} | base64 -d | crontab -`,
    { serverId, timeoutMs: 8000 },
  );
  if (write.code !== 0) {
    throw new ScheduleError(`crontab write failed: ${write.stderr.trim() || 'unknown'}`, 502);
  }
}

export async function removeFromCrontab(serverId: string, jobId: string): Promise<void> {
  const cur = await runOnHost('crontab -l 2>/dev/null', { serverId, timeoutMs: 8000 });
  const existingLines = (cur.code === 0 ? cur.stdout : '').split('\n');
  const kept: string[] = [];
  const target = `${TAG_PREFIX}${jobId}`;
  for (let i = 0; i < existingLines.length; i++) {
    if (existingLines[i]?.startsWith(target)) {
      i++; // skip the cron line that follows
      continue;
    }
    kept.push(existingLines[i] ?? '');
  }
  const newCrontab = kept.filter((l, idx, arr) => !(l === '' && idx === arr.length - 1)).join('\n') + '\n';
  const b64 = Buffer.from(newCrontab, 'utf-8').toString('base64');
  await runOnHost(`echo ${shellQuote(b64)} | base64 -d | crontab -`, {
    serverId,
    timeoutMs: 8000,
  });
}

export function validateCronExpr(expr: string) {
  if (!isReasonableCron(expr)) {
    throw new ScheduleError('cronExpr must be five space-separated fields using digits, *, /, -, , characters');
  }
}
