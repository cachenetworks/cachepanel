import { redirect } from 'next/navigation';
import { getPanelSession } from '@/lib/session';
import { PendingClient } from './pending-client';

export const dynamic = 'force-dynamic';

export default async function PendingPage() {
  const user = await getPanelSession();
  if (!user) redirect('/login');
  if (user.status === 'APPROVED') redirect('/dashboard');
  if (user.status === 'DISABLED') redirect('/login?error=disabled');
  return <PendingClient username={user.username} avatar={user.avatar} />;
}
