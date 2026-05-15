import { cn } from '@/lib/utils';

export function CachePanelLogo({
  size = 28,
  withText = true,
  className,
}: {
  size?: number;
  withText?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 64 64"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden
      >
        <defs>
          <linearGradient id="cp-grad" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
            <stop stopColor="#00F708" />
            <stop offset="1" stopColor="#E600FF" />
          </linearGradient>
        </defs>
        <rect x="2" y="2" width="60" height="60" rx="14" stroke="url(#cp-grad)" strokeWidth="2" />
        <path
          d="M20 24h24M20 32h18M20 40h12"
          stroke="url(#cp-grad)"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <circle cx="48" cy="40" r="3" fill="#00F708" />
      </svg>
      {withText ? (
        <div className="leading-none">
          <div className="text-base font-semibold tracking-tight text-white">
            Cache<span className="neon-text-green">Panel</span>
          </div>
          <div className="mt-0.5 text-[10px] uppercase tracking-[0.18em] text-white/40">
            secure server control
          </div>
        </div>
      ) : null}
    </div>
  );
}
