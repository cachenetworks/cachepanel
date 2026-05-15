import type { Role, UserStatus } from '@/lib/roles';
import 'next-auth';
import 'next-auth/jwt';

declare module 'next-auth' {
  interface Session {
    user: {
      id?: string;
      discordId?: string;
      username?: string;
      avatar?: string | null;
      email?: string | null;
      role?: Role;
      status?: UserStatus;
    };
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    uid?: string;
    discordId?: string;
    role?: Role;
    status?: UserStatus;
    username?: string;
    avatar?: string | null;
  }
}
