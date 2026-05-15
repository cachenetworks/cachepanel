import * as React from 'react';
import { cn } from '@/lib/utils';

type Tone = 'green' | 'magenta' | 'neutral' | 'red' | 'yellow' | 'blue';

const toneClass: Record<Tone, string> = {
  green: 'border-neon-green/40 bg-neon-green/10 text-neon-green',
  magenta: 'border-neon-magenta/40 bg-neon-magenta/10 text-neon-magenta',
  neutral: 'border-white/10 bg-white/5 text-white/70',
  red: 'border-red-500/40 bg-red-500/10 text-red-300',
  yellow: 'border-yellow-500/40 bg-yellow-500/10 text-yellow-300',
  blue: 'border-sky-500/40 bg-sky-500/10 text-sky-300',
};

export function Badge({
  tone = 'neutral',
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
        toneClass[tone],
        className,
      )}
      {...props}
    />
  );
}
