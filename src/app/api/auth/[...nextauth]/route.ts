import NextAuth from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import { primeConfigSnapshot } from '@/lib/config-snapshot';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Build the NextAuth handler per-request so the Discord provider always sees
// the freshest creds from the AppSetting snapshot. NextAuth(...) eagerly reads
// the providers array, so a cached handler from boot time would still hold
// the empty pre-setup creds even after /setup wrote them.
//
// Also primes the config snapshot before constructing — guarantees that even
// on the very first request after a cold boot we read the latest DB values.
async function handler(req: Request, ctx: { params: { nextauth: string[] } }) {
  await primeConfigSnapshot();
  const next = NextAuth(getAuthOptions());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (next as any)(req, ctx);
}

export { handler as GET, handler as POST };
