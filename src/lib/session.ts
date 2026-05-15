import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from './auth';
import type { Role, UserStatus } from './roles';

export interface PanelUser {
  id: string;
  discordId: string;
  username: string;
  avatar: string | null;
  email: string | null;
  role: Role;
  status: UserStatus;
}

export async function getPanelSession(): Promise<PanelUser | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return null;
  const u = session.user;
  return {
    id: u.id!,
    discordId: u.discordId ?? '',
    username: u.username ?? 'user',
    avatar: u.avatar ?? null,
    email: u.email ?? null,
    role: (u.role as Role) ?? 'ADMIN',
    status: (u.status as UserStatus) ?? 'PENDING',
  };
}

export async function requireApproved(): Promise<PanelUser> {
  const user = await getPanelSession();
  if (!user) redirect('/login');
  if (user.status === 'DISABLED') redirect('/login?error=disabled');
  if (user.status === 'PENDING') redirect('/pending');
  return user;
}

export async function requireOwner(): Promise<PanelUser> {
  const user = await requireApproved();
  if (user.role !== 'OWNER') redirect('/dashboard');
  return user;
}
