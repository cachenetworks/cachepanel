import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { CachePanelLogo } from '@/components/brand/logo';

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="glass-strong max-w-md p-8 text-center">
        <div className="flex justify-center">
          <CachePanelLogo size={36} withText={false} />
        </div>
        <h1 className="mt-5 text-2xl font-semibold text-white">404 — Not found</h1>
        <p className="mt-2 text-sm text-white/60">The page you’re looking for doesn’t exist in CachePanel.</p>
        <div className="mt-6">
          <Button asChild>
            <Link href="/dashboard">Back to dashboard</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
