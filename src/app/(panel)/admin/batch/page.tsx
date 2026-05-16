import { requireApproved } from '@/lib/session';
import { BatchClient } from './batch-client';

export const dynamic = 'force-dynamic';

export default async function BatchPage() {
  const user = await requireApproved();
  return <BatchClient user={user} />;
}
