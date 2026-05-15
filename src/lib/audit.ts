import { prisma } from './prisma';

export type AuditAction =
  | 'login.success'
  | 'login.failed'
  | 'user.pending_created'
  | 'user.approved'
  | 'user.disabled'
  | 'user.role_changed'
  | 'user.deleted'
  | 'terminal.session_opened'
  | 'terminal.session_closed'
  | 'terminal.command'
  | 'file.uploaded'
  | 'file.edited'
  | 'file.deleted'
  | 'file.renamed'
  | 'file.created'
  | 'settings.changed';

export async function audit(params: {
  userId?: string | null;
  action: AuditAction;
  target?: string | null;
  metadata?: Record<string, unknown> | null;
  ipAddress?: string | null;
}) {
  try {
    await prisma.auditLog.create({
      data: {
        userId: params.userId ?? null,
        action: params.action,
        target: params.target ?? null,
        metadata: params.metadata ? JSON.stringify(params.metadata) : null,
        ipAddress: params.ipAddress ?? null,
      },
    });
  } catch (err) {
    // Audit failures must never break the request — log to stderr.
    console.error('[audit] failed to persist log', err);
  }
}
