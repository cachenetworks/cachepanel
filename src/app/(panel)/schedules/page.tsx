import { requireApproved } from '@/lib/session';
import { SchedulesClient } from './schedules-client';

export const dynamic = 'force-dynamic';

export default async function SchedulesPage() {
  const user = await requireApproved();
  return <SchedulesClient user={user} />;
}
