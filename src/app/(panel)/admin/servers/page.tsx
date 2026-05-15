import { requireApproved } from '@/lib/session';
import { ServersClient } from './servers-client';

export const dynamic = 'force-dynamic';

export default async function ServersPage() {
  const user = await requireApproved();
  return <ServersClient role={user.role} />;
}
