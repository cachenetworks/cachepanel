import { requireApproved } from '@/lib/session';
import { adminCanApproveUsers } from '@/lib/settings';
import { UsersClient } from './users-client';

export const dynamic = 'force-dynamic';

export default async function UsersPage() {
  const user = await requireApproved();
  const adminCanApprove = await adminCanApproveUsers();
  return <UsersClient currentUserId={user.id} role={user.role} adminCanApprove={adminCanApprove} />;
}
