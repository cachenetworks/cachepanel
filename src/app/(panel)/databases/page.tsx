import { requireApproved } from '@/lib/session';
import { DatabasesClient } from './databases-client';

export const dynamic = 'force-dynamic';

export default async function DatabasesPage() {
  const user = await requireApproved();
  return <DatabasesClient role={user.role} />;
}
