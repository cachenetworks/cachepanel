import { requireApproved } from '@/lib/session';
import { RecordingsClient } from './recordings-client';

export const dynamic = 'force-dynamic';

export default async function RecordingsPage() {
  const user = await requireApproved();
  return <RecordingsClient user={user} />;
}
