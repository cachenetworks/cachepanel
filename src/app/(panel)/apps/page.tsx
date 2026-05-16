import { requireApproved } from '@/lib/session';
import { AppsClient } from './apps-client';

export const dynamic = 'force-dynamic';

export default async function AppsPage() {
  const user = await requireApproved();
  return <AppsClient user={user} />;
}
