import { redirect } from 'next/navigation';
import { getPanelSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const user = await getPanelSession();
  if (!user) redirect('/login');
  if (user.status === 'PENDING') redirect('/pending');
  if (user.status === 'DISABLED') redirect('/login?error=disabled');
  redirect('/dashboard');
}
