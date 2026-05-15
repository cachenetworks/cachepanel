import { cn } from '@/lib/utils';

interface ProgressProps {
  value: number;
  max?: number;
  tone?: 'green' | 'magenta' | 'mixed';
  className?: string;
}

export function Progress({ value, max = 100, tone = 'green', className }: ProgressProps) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const bar =
    tone === 'magenta'
      ? 'bg-neon-magenta shadow-neon-magenta'
      : tone === 'mixed'
        ? 'bg-gradient-to-r from-neon-green to-neon-magenta'
        : 'bg-neon-green shadow-neon-green';
  return (
    <div className={cn('h-2 w-full overflow-hidden rounded-full bg-white/5', className)}>
      <div className={cn('h-full rounded-full transition-all duration-500', bar)} style={{ width: `${pct}%` }} />
    </div>
  );
}
