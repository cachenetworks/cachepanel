'use client';

import * as React from 'react';
import { signOut } from 'next-auth/react';
import { LogOut, Shield, ShieldCheck, Menu } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MobileSidebar } from './mobile-sidebar';
import { ServerPicker } from './server-picker';
import { ThemeToggle } from './theme-toggle';
import type { PanelUser } from '@/lib/session';

export function Topbar({ user, title }: { user: PanelUser; title?: string }) {
  const [open, setOpen] = React.useState(false);
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background-elevated/80 px-4 backdrop-blur-xl md:px-6">
      <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
        <Menu className="h-5 w-5" />
      </Button>
      <div className="min-w-0 flex-1">
        {title ? <h1 className="truncate text-sm font-semibold tracking-tight text-foreground">{title}</h1> : null}
      </div>
      <div className="hidden md:block">
        <ServerPicker />
      </div>
      <ThemeToggle />
      <DropdownMenu>
        <DropdownMenuTrigger className="flex items-center gap-3 rounded-full border border-white/[0.06] bg-white/[0.02] py-1 pl-1 pr-3 transition-colors hover:border-white/15">
          <Avatar src={user.avatar} fallback={user.username} size={28} />
          <div className="hidden text-left sm:block">
            <div className="text-xs font-semibold leading-tight text-white">{user.username}</div>
            <div className={`text-[10px] uppercase tracking-wider ${user.role === 'OWNER' ? 'text-neon-magenta' : 'text-neon-green'}`}>
              {user.role}
            </div>
          </div>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Signed in as</DropdownMenuLabel>
          <DropdownMenuItem disabled className="opacity-100">
            <div className="flex flex-col">
              <span className="font-medium text-white">{user.username}</span>
              <span className="text-[11px] text-white/50">Discord: {user.discordId}</span>
            </div>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled className="opacity-100">
            {user.role === 'OWNER' ? <ShieldCheck className="h-4 w-4 text-neon-magenta" /> : <Shield className="h-4 w-4 text-neon-green" />}
            <span className="text-xs text-white/70">{user.role === 'OWNER' ? 'Owner' : 'Admin'}</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem danger onClick={() => signOut({ callbackUrl: '/login' })}>
            <LogOut className="h-4 w-4" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <MobileSidebar open={open} onOpenChange={setOpen} role={user.role} />
    </header>
  );
}
