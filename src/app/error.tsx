'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { CachePanelLogo } from '@/components/brand/logo';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="glass-strong max-w-md p-8 text-center">
        <div className="flex justify-center">
          <CachePanelLogo size={36} withText={false} />
        </div>
        <h1 className="mt-5 text-2xl font-semibold text-white">Something went wrong</h1>
        <p className="mt-2 text-xs text-white/50">{error.message}</p>
        <div className="mt-6">
          <Button onClick={reset}>Try again</Button>
        </div>
      </div>
    </div>
  );
}
