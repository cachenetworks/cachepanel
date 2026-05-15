import { requireApproved } from '@/lib/session';
import { TunnelsClient } from './tunnels-client';

export const dynamic = 'force-dynamic';

export default async function TunnelsPage() {
  const user = await requireApproved();
  return <TunnelsClient role={user.role} />;
}
