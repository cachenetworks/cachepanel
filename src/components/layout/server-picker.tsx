'use client';

import * as React from 'react';
import { Check, Server as ServerIcon } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { useServer } from './server-context';

export function ServerPicker() {
  const { servers, current, setCurrent } = useServer();
  if (servers.length <= 1 && current?.isPrimary) {
    // Single-server install — no picker, just a label.
    return (
      <div className="hidden items-center gap-2 rounded-full border border-white/[0.06] bg-white/[0.02] px-3 py-1 sm:flex">
        <ServerIcon className="h-3 w-3 text-neon-green" />
        <span className="text-xs font-medium text-white">{current?.name ?? 'primary'}</span>
        <Badge tone="green">primary</Badge>
      </div>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-2 rounded-full border border-white/[0.06] bg-white/[0.02] px-3 py-1 transition-colors hover:border-white/15">
        <ServerIcon className="h-3.5 w-3.5 text-neon-green" />
        <span className="text-xs font-medium text-white">{current?.name ?? 'select…'}</span>
        {current?.isPrimary ? <Badge tone="green">primary</Badge> : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[16rem]">
        <DropdownMenuLabel>Active server</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {servers.map((s) => (
          <DropdownMenuItem key={s.id} onClick={() => setCurrent(s)}>
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex items-center gap-2 truncate">
                <ServerIcon className="h-3 w-3 text-white/40" />
                <span className="truncate text-white">{s.name}</span>
                {s.isPrimary ? <Badge tone="green">primary</Badge> : null}
              </div>
              <div className="ml-5 truncate text-[10px] text-white/40">{s.hostname}</div>
            </div>
            {current?.id === s.id ? <Check className="h-3 w-3 text-neon-green" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
