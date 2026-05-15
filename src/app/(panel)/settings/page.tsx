import { requireApproved } from '@/lib/session';
import { SettingsClient } from './settings-client';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const user = await requireApproved();
  return <SettingsClient user={user} />;
}
