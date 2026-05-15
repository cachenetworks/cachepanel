import { redirect } from 'next/navigation';
import { LoginClient } from './login-client';
import { getPanelSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: { error?: string; callbackUrl?: string };
}) {
  const user = await getPanelSession();
  if (user && user.status === 'APPROVED') redirect('/dashboard');
  if (user && user.status === 'PENDING') redirect('/pending');
  return <LoginClient error={searchParams.error} callbackUrl={searchParams.callbackUrl ?? '/dashboard'} />;
}
