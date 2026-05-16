'use client';

import * as React from 'react';
import { ShieldCheck, Save, Folder, Server, Globe, Power, FileWarning } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardSubtitle, CardBody } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toaster';
import { cn } from '@/lib/utils';
import type { PanelUser } from '@/lib/session';
import { AlertsCard } from './alerts-card';

interface SettingsResponse {
  settings: {
    admin_can_approve_users: boolean;
    allow_dotenv_access: boolean;
    terminal_enabled: boolean;
    terminal_audit_commands: boolean;
  };
  env: {
    allowed_file_roots: string[];
    discord_guild_id: string | null;
    discord_role_check: boolean;
    discord_user_allowlist_count: number;
    terminal_shell: string;
    terminal_user: string | null;
    terminal_start_dir: string;
  };
}

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={cn(
        'relative h-6 w-11 rounded-full border transition-all',
        checked ? 'border-neon-green/40 bg-neon-green/20 shadow-neon-green' : 'border-white/15 bg-white/5',
        disabled && 'opacity-50 cursor-not-allowed',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all',
          checked ? 'left-[1.4rem] bg-neon-green' : 'left-0.5',
        )}
      />
    </button>
  );
}

export function SettingsClient({ user }: { user: PanelUser }) {
  const { toast } = useToast();
  const [data, setData] = React.useState<SettingsResponse | null>(null);
  const [draft, setDraft] = React.useState<SettingsResponse['settings'] | null>(null);
  const [saving, setSaving] = React.useState(false);
  const isOwner = user.role === 'OWNER';

  React.useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/settings', { cache: 'no-store' });
        if (!res.ok) throw new Error(await res.text());
        const body = (await res.json()) as SettingsResponse;
        setData(body);
        setDraft(body.settings);
      } catch (err) {
        toast({ variant: 'error', title: 'Failed to load settings', description: err instanceof Error ? err.message : String(err) });
      }
    })();
  }, [toast]);

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Failed');
      toast({ variant: 'success', title: 'Settings saved' });
    } catch (err) {
      toast({ variant: 'error', title: 'Save failed', description: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-white">Settings</h1>
        <p className="text-xs text-white/50">
          {isOwner ? 'Manage critical CachePanel settings.' : 'Most settings are OWNER-only. View your profile below.'}
        </p>
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Profile</CardTitle>
            <CardSubtitle>Your CachePanel identity</CardSubtitle>
          </div>
          <Badge tone={user.role === 'OWNER' ? 'magenta' : 'green'}>{user.role}</Badge>
        </CardHeader>
        <CardBody>
          <div className="flex items-center gap-4">
            <Avatar src={user.avatar} fallback={user.username} size={56} className="ring-2 ring-neon-green/30" />
            <div>
              <div className="text-base font-semibold text-white">{user.username}</div>
              <div className="text-xs text-white/50">{user.email ?? 'no email on record'}</div>
              <div className="mt-1 text-[11px] text-white/40">Discord ID: {user.discordId}</div>
            </div>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Approval & access</CardTitle>
            <CardSubtitle>OWNER-only critical settings</CardSubtitle>
          </div>
          <ShieldCheck className={cn('h-4 w-4', isOwner ? 'text-neon-magenta' : 'text-white/30')} />
        </CardHeader>
        <CardBody>
          {!draft ? (
            <div className="space-y-3">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              <Row
                title="Allow ADMINs to approve pending users"
                description="When enabled, ADMINs may approve PENDING users — but only as ADMIN, never as OWNER."
                checked={draft.admin_can_approve_users}
                onChange={(v) => setDraft({ ...draft, admin_can_approve_users: v })}
                disabled={!isOwner}
              />
              <Row
                title="Allow .env file access (OWNER)"
                description="When enabled, OWNER can read and edit .env files inside allowed roots. Strongly discouraged."
                checked={draft.allow_dotenv_access}
                onChange={(v) => setDraft({ ...draft, allow_dotenv_access: v })}
                disabled={!isOwner}
              />
              <Row
                title="Enable terminal"
                description="When disabled, the /terminal page is unavailable for every user."
                checked={draft.terminal_enabled}
                onChange={(v) => setDraft({ ...draft, terminal_enabled: v })}
                disabled={!isOwner}
              />
              <Row
                title="Audit terminal commands"
                description="Logs each command line typed into the terminal. Off by default."
                checked={draft.terminal_audit_commands}
                onChange={(v) => setDraft({ ...draft, terminal_audit_commands: v })}
                disabled={!isOwner}
              />
              {isOwner ? (
                <div className="flex justify-end pt-2">
                  <Button onClick={save} disabled={saving}>
                    <Save className="h-4 w-4" />
                    {saving ? 'Saving…' : 'Save changes'}
                  </Button>
                </div>
              ) : (
                <p className="rounded-md border border-white/10 bg-white/[0.02] p-2 text-xs text-white/50">
                  These settings are read-only for ADMINs.
                </p>
              )}
            </div>
          )}
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>File roots</CardTitle>
              <CardSubtitle>Set via ALLOWED_FILE_ROOTS env var</CardSubtitle>
            </div>
            <Folder className="h-4 w-4 text-white/30" />
          </CardHeader>
          <CardBody>
            {data?.env.allowed_file_roots.length ? (
              <ul className="flex flex-col gap-1.5 font-mono text-xs">
                {data.env.allowed_file_roots.map((r) => (
                  <li key={r} className="rounded-md border border-white/5 bg-white/[0.02] px-2 py-1.5 text-white/80">
                    {r}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex items-center gap-2 rounded-md border border-yellow-500/30 bg-yellow-500/10 p-3 text-xs text-yellow-200">
                <FileWarning className="h-4 w-4" />
                No file roots configured — file manager will be unavailable.
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Discord auth</CardTitle>
              <CardSubtitle>Configured via env vars</CardSubtitle>
            </div>
            <Globe className="h-4 w-4 text-white/30" />
          </CardHeader>
          <CardBody>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-[10px] uppercase tracking-wider text-white/40">Guild check</dt>
                <dd className="mt-1">
                  {data?.env.discord_guild_id ? (
                    <Badge tone="green">enabled</Badge>
                  ) : (
                    <Badge tone="neutral">off</Badge>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-wider text-white/40">Role check</dt>
                <dd className="mt-1">
                  {data?.env.discord_role_check ? (
                    <Badge tone="green">enabled</Badge>
                  ) : (
                    <Badge tone="neutral">off</Badge>
                  )}
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-[10px] uppercase tracking-wider text-white/40">User ID allowlist</dt>
                <dd className="mt-1">
                  {data && data.env.discord_user_allowlist_count > 0 ? (
                    <Badge tone="green">{data.env.discord_user_allowlist_count} allowed</Badge>
                  ) : (
                    <Badge tone="neutral">off — any Discord user may attempt login</Badge>
                  )}
                </dd>
              </div>
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Terminal runtime</CardTitle>
              <CardSubtitle>Configured via env vars</CardSubtitle>
            </div>
            <Server className="h-4 w-4 text-white/30" />
          </CardHeader>
          <CardBody>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-[10px] uppercase tracking-wider text-white/40">Shell</dt>
                <dd className="mt-1 font-mono text-xs text-white">{data?.env.terminal_shell ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-wider text-white/40">User</dt>
                <dd className="mt-1 font-mono text-xs text-white">{data?.env.terminal_user ?? '(inherit)'}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-[10px] uppercase tracking-wider text-white/40">Start dir</dt>
                <dd className="mt-1 font-mono text-xs text-white">{data?.env.terminal_start_dir ?? '—'}</dd>
              </div>
            </dl>
            <div className="mt-3 flex items-center gap-2 rounded-md border border-white/5 bg-white/[0.02] p-2 text-[11px] text-white/60">
              <Power className="h-3.5 w-3.5 text-neon-green" />
              Running as a non-root user is strongly recommended.
            </div>
          </CardBody>
        </Card>
      </div>

      <AlertsCard isOwner={isOwner} />
    </div>
  );
}

function Row({
  title,
  description,
  checked,
  onChange,
  disabled,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-white/5 bg-white/[0.02] p-3">
      <div>
        <div className="text-sm font-medium text-white">{title}</div>
        <div className="mt-0.5 text-xs text-white/50">{description}</div>
      </div>
      <Toggle checked={checked} onChange={onChange} disabled={disabled} />
    </div>
  );
}
