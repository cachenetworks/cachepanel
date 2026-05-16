import { requireApproved } from '@/lib/session';
import { CleanupClient } from './cleanup-client';

export const dynamic = 'force-dynamic';

export default async function DockerCleanupPage() {
  const user = await requireApproved();
  return <CleanupClient user={user} />;
}
