'use client';

import * as React from 'react';
import { SessionProvider } from 'next-auth/react';
import { Toaster } from '@/components/ui/toaster';
import { ServerProvider } from './server-context';

function PresencePing() {
  React.useEffect(() => {
    let cancelled = false;
    const ping = () => {
      if (cancelled || document.hidden) return;
      fetch('/api/me', { cache: 'no-store' }).catch(() => undefined);
    };
    ping();
    const id = setInterval(ping, 30_000);
    const onVis = () => !document.hidden && ping();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);
  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <ServerProvider>
        <Toaster>
          <PresencePing />
          {children}
        </Toaster>
      </ServerProvider>
    </SessionProvider>
  );
}
