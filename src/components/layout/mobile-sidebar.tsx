'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { X } from 'lucide-react';
import { CachePanelLogo } from '@/components/brand/logo';
import { cn } from '@/lib/utils';
import { visibleNavItems } from './nav-items';
import { ServerPicker } from './server-picker';

export function MobileSidebar({
  open,
  onOpenChange,
  role,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  role: 'OWNER' | 'ADMIN';
}) {
  const pathname = usePathname();
  const items = visibleNavItems(role);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 md:hidden" />
        <DialogPrimitive.Content className="fixed left-0 top-0 z-50 flex h-full w-72 flex-col border-r border-border bg-background-elevated/95 backdrop-blur-xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left md:hidden">
          <div className="flex items-center justify-between px-5 py-4">
            <CachePanelLogo />
            <DialogPrimitive.Close className="rounded p-1 text-foreground-subtle hover:bg-background-card hover:text-foreground" aria-label="Close menu">
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>
          </div>

          {/* Server picker is hidden on mobile in topbar to save width;
              surface it inside the drawer where space is plentiful. */}
          <div className="border-y border-border px-4 py-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground-subtle">
              Active server
            </div>
            <div className="mt-1.5">
              <ServerPicker />
            </div>
          </div>

          <nav className="flex-1 overflow-y-auto px-3 py-2">
            <ul className="flex flex-col gap-1">
              {items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(item.href + '/');
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={() => onOpenChange(false)}
                      className={cn(
                        'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                        active
                          ? 'border border-neon-green/40 bg-neon-green/10 text-neon-green'
                          : 'border border-transparent text-foreground-muted hover:bg-background-card hover:text-foreground',
                      )}
                    >
                      {item.icon}
                      <span>{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          <div className="border-t border-border px-5 py-3 text-xs text-foreground-subtle">
            Role: <span className={role === 'OWNER' ? 'neon-text-magenta' : 'neon-text-green'}>{role}</span>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
