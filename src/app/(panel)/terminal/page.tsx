import { requireApproved } from '@/lib/session';
import { getEnv } from '@/lib/env';
import { getBool } from '@/lib/settings';
import { TerminalClient } from './terminal-client';
import { EmptyState } from '@/components/ui/empty';
import { TerminalSquare } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function TerminalPage() {
  const user = await requireApproved();
  const env = getEnv();
  const enabled = await getBool('terminal_enabled', env.TERMINAL_ENABLED);
  if (!enabled) {
    return (
      <EmptyState
        icon={<TerminalSquare className="h-8 w-8" />}
        title="Terminal is disabled"
        description="An OWNER has disabled terminal access for this CachePanel instance."
      />
    );
  }
  return <TerminalClient username={user.username} role={user.role} />;
}
