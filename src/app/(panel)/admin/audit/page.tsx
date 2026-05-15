import { requireApproved } from '@/lib/session';
import { AuditClient } from './audit-client';

export const dynamic = 'force-dynamic';

export default async function AuditPage() {
  const user = await requireApproved();
  return <AuditClient role={user.role} />;
}
