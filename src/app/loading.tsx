import { CachePanelLogo } from '@/components/brand/logo';

export default function Loading() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-white/60">
        <CachePanelLogo size={36} withText={false} />
        <div className="text-xs uppercase tracking-[0.18em] text-white/40">Loading CachePanel…</div>
      </div>
    </div>
  );
}
