'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Activity, Box, Cloud, Database, Folder, ScrollText, Server, Settings, Sparkles, TerminalSquare, Users, X } from 'lucide-react';
import { CachePanelLogo } from '@/components/brand/logo';
import { cn } from '@/lib/utils';

const items = [
  { href: '/dashboard', label: 'Dashboard', icon: <Activity className="h-4 w-4" /> },
  { href: '/terminal', label: 'Terminal', icon: <TerminalSquare className="h-4 w-4" /> },
  { href: '/files', label: 'Files', icon: <Folder className="h-4 w-4" /> },
  { href: '/docker', label: 'Docker', icon: <Box className="h-4 w-4" /> },
  { href: '/databases', label: 'Databases', icon: <Database className="h-4 w-4" /> },
  { href: '/tunnels', label: 'Tunnels', icon: <Cloud className="h-4 w-4" /> },
  { href: '/assistant', label: 'Assistant', icon: <Sparkles className="h-4 w-4" /> },
  { href: '/admin/servers', label: 'Servers', icon: <Server className="h-4 w-4" /> },
  { href: '/admin/users', label: 'Users', icon: <Users className="h-4 w-4" /> },
  { href: '/admin/audit', label: 'Audit log', icon: <ScrollText className="h-4 w-4" /> },
  { href: '/settings', label: 'Settings', icon: <Settings className="h-4 w-4" /> },
];

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
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 md:hidden" />
        <DialogPrimitive.Content className="fixed left-0 top-0 z-50 h-full w-64 border-r border-white/[0.06] bg-background-elevated/95 backdrop-blur-xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left md:hidden">
          <div className="flex items-center justify-between px-5 py-5">
            <CachePanelLogo />
            <DialogPrimitive.Close className="rounded p-1 text-white/50 hover:bg-white/10 hover:text-white">
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>
          </div>
          <nav className="px-3">
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
                          : 'border border-transparent text-white/70 hover:bg-white/5 hover:text-white',
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
          <div className="absolute bottom-4 left-4 right-4 border-t border-white/10 pt-3 text-xs text-white/40">
            Role: <span className={role === 'OWNER' ? 'neon-text-magenta' : 'neon-text-green'}>{role}</span>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
