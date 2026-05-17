'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ClipboardList } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CachePanelLogo } from '@/components/brand/logo';
import { visibleNavItems } from './nav-items';

export function Sidebar({ role }: { role: 'OWNER' | 'ADMIN' }) {
  const pathname = usePathname();
  const items = visibleNavItems(role);
  return (
    <aside className="hidden w-64 shrink-0 border-r border-border bg-background-elevated/60 backdrop-blur-xl md:flex md:flex-col">
      <div className="px-5 py-5">
        <Link href="/dashboard">
          <CachePanelLogo />
        </Link>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 py-2">
        <div className="px-2 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground-subtle">
          Navigation
        </div>
        <ul className="flex flex-col gap-1">
          {items.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + '/');
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all',
                    active
                      ? 'border border-neon-green/40 bg-neon-green/10 text-neon-green shadow-neon-green'
                      : 'border border-transparent text-foreground-muted hover:bg-background-card hover:text-foreground',
                  )}
                >
                  <span className={cn('transition-colors', active ? 'text-neon-green' : 'text-foreground-subtle group-hover:text-foreground')}>
                    {item.icon}
                  </span>
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="border-t border-border px-5 py-4">
        <div className="flex items-center gap-2 text-xs text-foreground-subtle">
          <ClipboardList className="h-3.5 w-3.5" />
          <span>Role: <span className={role === 'OWNER' ? 'neon-text-magenta' : 'neon-text-green'}>{role}</span></span>
        </div>
      </div>
    </aside>
  );
}
