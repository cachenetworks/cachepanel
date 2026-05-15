'use client';

import * as React from 'react';
import * as AvatarPrimitive from '@radix-ui/react-avatar';
import { cn } from '@/lib/utils';

export function Avatar({
  src,
  fallback,
  className,
  size = 32,
}: {
  src?: string | null;
  fallback: string;
  className?: string;
  size?: number;
}) {
  return (
    <AvatarPrimitive.Root
      className={cn(
        'relative inline-flex shrink-0 overflow-hidden rounded-full border border-white/10 bg-white/5',
        className,
      )}
      style={{ width: size, height: size }}
    >
      {src ? (
        <AvatarPrimitive.Image src={src} alt={fallback} className="h-full w-full object-cover" />
      ) : null}
      <AvatarPrimitive.Fallback
        delayMs={200}
        className="flex h-full w-full items-center justify-center text-xs font-semibold text-white/70"
      >
        {fallback?.slice(0, 2).toUpperCase() || '?'}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}
