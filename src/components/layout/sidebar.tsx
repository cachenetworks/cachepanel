'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Activity,
  Box,
  ClipboardList,
  Cloud,
  Database,
  Folder,
  ScrollText,
  Server,
  Settings,
  Sparkles,
  TerminalSquare,
  Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { CachePanelLogo } from '@/components/brand/logo';

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  ownerOnly?: boolean;
}

const navItems: NavItem[] = [
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

export function Sidebar({ role }: { role: 'OWNER' | 'ADMIN' }) {
  const pathname = usePathname();
  return (
    <aside className="hidden w-64 shrink-0 border-r border-white/[0.06] bg-black/40 backdrop-blur-xl md:flex md:flex-col">
      <div className="px-5 py-5">
        <Link href="/dashboard">
          <CachePanelLogo />
        </Link>
      </div>
      <nav className="flex-1 px-3 py-2">
        <div className="px-2 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/30">
          Navigation
        </div>
        <ul className="flex flex-col gap-1">
          {navItems.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + '/');
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all',
                    active
                      ? 'border border-neon-green/40 bg-neon-green/10 text-neon-green shadow-neon-green'
                      : 'border border-transparent text-white/70 hover:bg-white/5 hover:text-white',
                  )}
                >
                  <span className={cn('transition-colors', active ? 'text-neon-green' : 'text-white/50 group-hover:text-white')}>
                    {item.icon}
                  </span>
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="border-t border-white/[0.06] px-5 py-4">
        <div className="flex items-center gap-2 text-xs text-white/40">
          <ClipboardList className="h-3.5 w-3.5" />
          <span>Role: <span className={role === 'OWNER' ? 'neon-text-magenta' : 'neon-text-green'}>{role}</span></span>
        </div>
      </div>
    </aside>
  );
}
