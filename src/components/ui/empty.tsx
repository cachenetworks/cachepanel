import * as React from 'react';
import { cn } from '@/lib/utils';

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-white/10 bg-white/[0.02] px-6 py-10 text-center',
        className,
      )}
    >
      {icon ? <div className="text-white/40">{icon}</div> : null}
      <div className="text-sm font-medium text-white/80">{title}</div>
      {description ? <div className="max-w-md text-xs text-white/50">{description}</div> : null}
      {action}
    </div>
  );
}
