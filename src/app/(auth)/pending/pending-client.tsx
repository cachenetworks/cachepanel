'use client';

import { signOut } from 'next-auth/react';
import { Clock, LogOut, RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/avatar';
import { CachePanelLogo } from '@/components/brand/logo';

export function PendingClient({ username, avatar }: { username: string; avatar: string | null }) {
  const router = useRouter();
  return (
    <div className="relative flex min-h-screen items-center justify-center px-4">
      <div className="pointer-events-none absolute inset-0 bg-grid-fade opacity-80" />
      <div className="relative w-full max-w-md glass-strong p-8 text-center">
        <div className="flex justify-center">
          <CachePanelLogo size={36} withText={false} />
        </div>
        <div className="mt-6 flex justify-center">
          <div className="relative">
            <Avatar src={avatar} fallback={username} size={72} className="ring-2 ring-neon-magenta/40" />
            <span className="absolute -bottom-1 -right-1 inline-flex h-6 w-6 items-center justify-center rounded-full border border-neon-magenta/40 bg-background-elevated">
              <Clock className="h-3 w-3 text-neon-magenta" />
            </span>
          </div>
        </div>
        <h1 className="mt-5 text-xl font-semibold text-white">Waiting for approval</h1>
        <p className="mt-2 text-sm text-white/60">
          Your CachePanel account is waiting for owner approval.
        </p>
        <p className="mt-1 text-xs text-white/40">
          Signed in as <span className="text-white/80">{username}</span>
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <Button variant="magenta" onClick={() => router.refresh()}>
            <RefreshCw className="h-4 w-4" />
            Check status again
          </Button>
          <Button variant="ghost" onClick={() => signOut({ callbackUrl: '/login' })}>
            <LogOut className="h-4 w-4" />
            Sign out
          </Button>
        </div>
      </div>
    </div>
  );
}
