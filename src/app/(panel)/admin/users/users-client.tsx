'use client';

import * as React from 'react';
import {
  Check,
  Copy,
  KeyRound,
  Loader2,
  MoreVertical,
  Search,
  Shield,
  ShieldCheck,
  ShieldOff,
  Terminal,
  Trash2,
  UserX,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty';
import { useToast } from '@/components/ui/toaster';
import { formatRelative } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface UserRow {
  id: string;
  discordId: string;
  username: string;
  avatar: string | null;
  email: string | null;
  role: 'OWNER' | 'ADMIN';
  status: 'PENDING' | 'APPROVED' | 'DISABLED';
  lastLoginAt: string | null;
  createdAt: string;
  online: boolean;
  lastSeenAt: string | null;
  sshAccess: boolean;
  sshSudo: boolean;
  sshUsername: string | null;
  sshProvisioned: boolean;
}

interface SshDetails {
  sshAccess: boolean;
  sshSudo: boolean;
  sshUsername: string | null;
  sshProvisioned: boolean;
  suggestedUsername: string;
  publicKey: string | null;
}

export function UsersClient({
  currentUserId,
  role,
  adminCanApprove,
}: {
  currentUserId: string;
  role: 'OWNER' | 'ADMIN';
  adminCanApprove: boolean;
}) {
  const { toast } = useToast();
  const [q, setQ] = React.useState('');
  const [roleFilter, setRoleFilter] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState('');
  const [users, setUsers] = React.useState<UserRow[] | null>(null);
  const [refreshKey, setRefreshKey] = React.useState(0);
  const [confirm, setConfirm] = React.useState<null | { kind: 'disable' | 'delete' | 'demote'; user: UserRow }>(null);
  const [sshFor, setSshFor] = React.useState<UserRow | null>(null);
  const [sshDetails, setSshDetails] = React.useState<SshDetails | null>(null);
  const [sshDraft, setSshDraft] = React.useState<{ username: string; sudo: boolean } | null>(null);
  const [sshBusy, setSshBusy] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (roleFilter) params.set('role', roleFilter);
      if (statusFilter) params.set('status', statusFilter);
      try {
        const res = await fetch(`/api/users?${params.toString()}`, { cache: 'no-store' });
        if (!res.ok) throw new Error(await res.text());
        const body = (await res.json()) as { users: UserRow[] };
        if (!cancelled) setUsers(body.users);
      } catch (err) {
        if (!cancelled) toast({ variant: 'error', title: 'Failed to load users', description: err instanceof Error ? err.message : String(err) });
      }
    };
    load();
    // Poll presence every 15s so the online dots stay fresh without
    // hammering the API on text input.
    const timer = setInterval(load, 15_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [q, roleFilter, statusFilter, refreshKey, toast]);

  const refresh = () => setRefreshKey((k) => k + 1);

  async function call(method: string, url: string, body?: unknown): Promise<void> {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error ?? `Failed (${res.status})`);
    }
  }

  async function approve(u: UserRow) {
    try {
      await call('POST', `/api/users/${u.id}/approve`);
      toast({ variant: 'success', title: 'User approved', description: u.username });
      refresh();
    } catch (err) {
      toast({ variant: 'error', title: 'Approve failed', description: err instanceof Error ? err.message : String(err) });
    }
  }
  async function disable(u: UserRow) {
    try {
      await call('POST', `/api/users/${u.id}/disable`);
      toast({ variant: 'success', title: 'User disabled', description: u.username });
      refresh();
    } catch (err) {
      toast({ variant: 'error', title: 'Disable failed', description: err instanceof Error ? err.message : String(err) });
    }
  }
  async function setRole(u: UserRow, newRole: 'OWNER' | 'ADMIN') {
    try {
      await call('POST', `/api/users/${u.id}/role`, { role: newRole });
      toast({ variant: 'success', title: `Role changed`, description: `${u.username} → ${newRole}` });
      refresh();
    } catch (err) {
      toast({ variant: 'error', title: 'Role change failed', description: err instanceof Error ? err.message : String(err) });
    }
  }
  async function deleteUser(u: UserRow) {
    try {
      await call('DELETE', `/api/users/${u.id}`);
      toast({ variant: 'success', title: 'User deleted', description: u.username });
      refresh();
    } catch (err) {
      toast({ variant: 'error', title: 'Delete failed', description: err instanceof Error ? err.message : String(err) });
    }
  }

  const canApprove = role === 'OWNER' || adminCanApprove;
  const canModify = role === 'OWNER';

  async function openSsh(u: UserRow) {
    setSshFor(u);
    setSshDetails(null);
    setSshDraft(null);
    try {
      const res = await fetch(`/api/users/${u.id}/ssh`, { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Failed (${res.status})`);
      setSshDetails(body);
      setSshDraft({ username: body.sshUsername ?? body.suggestedUsername, sudo: !!body.sshSudo });
    } catch (err) {
      toast({ variant: 'error', title: 'Failed to load SSH info', description: err instanceof Error ? err.message : String(err) });
    }
  }

  async function applySsh(enable: boolean) {
    if (!sshFor || !sshDraft) return;
    setSshBusy(true);
    try {
      const res = await fetch(`/api/users/${sshFor.id}/ssh`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enable, sudo: sshDraft.sudo, username: sshDraft.username }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Failed (${res.status})`);
      toast({ variant: 'success', title: enable ? 'SSH enabled' : 'SSH disabled' });
      // Refresh the dialog and the underlying users list
      await openSsh(sshFor);
      refresh();
    } catch (err) {
      toast({ variant: 'error', title: 'SSH update failed', description: err instanceof Error ? err.message : String(err) });
    } finally {
      setSshBusy(false);
    }
  }

  async function deleteSsh() {
    if (!sshFor) return;
    setSshBusy(true);
    try {
      const res = await fetch(`/api/users/${sshFor.id}/ssh`, { method: 'DELETE' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Failed (${res.status})`);
      toast({ variant: 'success', title: 'SSH account deleted' });
      await openSsh(sshFor);
      refresh();
    } catch (err) {
      toast({ variant: 'error', title: 'Delete failed', description: err instanceof Error ? err.message : String(err) });
    } finally {
      setSshBusy(false);
    }
  }

  function copyKey() {
    if (sshDetails?.publicKey) {
      navigator.clipboard.writeText(sshDetails.publicKey).then(
        () => toast({ variant: 'success', title: 'Public key copied' }),
        () => toast({ variant: 'error', title: 'Copy failed' }),
      );
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-white">Users</h1>
          <p className="text-xs text-white/50">
            {role === 'OWNER'
              ? 'You can approve, disable, and change roles.'
              : adminCanApprove
                ? 'ADMINs may approve pending users as ADMIN.'
                : 'Read-only — only OWNER can manage users.'}
          </p>
        </div>
      </div>

      <Card className="p-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/40" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, Discord ID, email…" className="pl-9" />
          </div>
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="h-10 rounded-lg border border-white/10 bg-black/40 px-3 text-sm text-white outline-none focus:border-neon-green/40"
          >
            <option value="">All roles</option>
            <option value="OWNER">OWNER</option>
            <option value="ADMIN">ADMIN</option>
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-10 rounded-lg border border-white/10 bg-black/40 px-3 text-sm text-white outline-none focus:border-neon-green/40"
          >
            <option value="">All statuses</option>
            <option value="PENDING">Pending</option>
            <option value="APPROVED">Approved</option>
            <option value="DISABLED">Disabled</option>
          </select>
        </div>
      </Card>

      <Card className="p-0">
        {users === null ? (
          <div className="space-y-2 p-5">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : users.length === 0 ? (
          <EmptyState title="No users match" description="Try clearing search filters." />
        ) : (
          <div className="divide-y divide-white/[0.04]">
            <div className="grid grid-cols-[2fr_1fr_1fr_140px_60px] gap-3 px-5 py-3 text-[10px] uppercase tracking-wider text-white/40">
              <div>User</div>
              <div>Role</div>
              <div>Status</div>
              <div>Last login</div>
              <div />
            </div>
            {users.map((u) => (
              <div key={u.id} className="grid grid-cols-[2fr_1fr_1fr_140px_60px] items-center gap-3 px-5 py-3 transition-colors hover:bg-white/[0.03]">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="relative">
                    <Avatar src={u.avatar} fallback={u.username} size={32} />
                    <span
                      title={u.online ? 'Online' : u.lastSeenAt ? `Last seen ${new Date(u.lastSeenAt).toLocaleString()}` : 'Offline'}
                      className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-background-elevated ${
                        u.online ? 'bg-neon-green shadow-neon-green' : 'bg-white/20'
                      }`}
                    />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 truncate text-sm text-white">
                      {u.username}
                      {u.id === currentUserId ? <Badge tone="neutral">you</Badge> : null}
                      {u.online ? <Badge tone="green">online</Badge> : null}
                      {u.sshAccess && u.sshProvisioned ? (
                        <Badge tone={u.sshSudo ? 'magenta' : 'green'}>
                          <KeyRound className="h-3 w-3" />
                          ssh{u.sshSudo ? '·sudo' : ''}
                        </Badge>
                      ) : null}
                    </div>
                    <div className="truncate text-[11px] text-white/40">
                      {u.sshUsername ? `${u.sshUsername} @ host · ` : ''}
                      {u.email ?? `Discord: ${u.discordId}`}
                    </div>
                  </div>
                </div>
                <div>
                  <Badge tone={u.role === 'OWNER' ? 'magenta' : 'green'}>
                    {u.role === 'OWNER' ? <ShieldCheck className="h-3 w-3" /> : <Shield className="h-3 w-3" />}
                    {u.role}
                  </Badge>
                </div>
                <div>
                  <Badge
                    tone={u.status === 'APPROVED' ? 'green' : u.status === 'PENDING' ? 'yellow' : 'red'}
                  >
                    {u.status}
                  </Badge>
                </div>
                <div className="text-xs text-white/50">{formatRelative(u.lastLoginAt)}</div>
                <div className="flex justify-end">
                  <DropdownMenu>
                    <DropdownMenuTrigger className="rounded p-1 text-white/40 hover:bg-white/10 hover:text-white">
                      <MoreVertical className="h-4 w-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {u.status === 'PENDING' && canApprove ? (
                        <DropdownMenuItem onClick={() => approve(u)}>
                          <Check className="h-4 w-4 text-neon-green" />
                          Approve as ADMIN
                        </DropdownMenuItem>
                      ) : null}
                      {canModify && u.role !== 'OWNER' ? (
                        <DropdownMenuItem onClick={() => setRole(u, 'OWNER')}>
                          <ShieldCheck className="h-4 w-4 text-neon-magenta" />
                          Promote to OWNER
                        </DropdownMenuItem>
                      ) : null}
                      {canModify && u.role === 'OWNER' && u.id !== currentUserId ? (
                        <DropdownMenuItem onClick={() => setConfirm({ kind: 'demote', user: u })}>
                          <Shield className="h-4 w-4 text-neon-green" />
                          Demote to ADMIN
                        </DropdownMenuItem>
                      ) : null}
                      {canModify ? (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => openSsh(u)}>
                            <KeyRound className="h-4 w-4 text-neon-green" />
                            Manage SSH access
                          </DropdownMenuItem>
                        </>
                      ) : null}
                      {canModify && u.status !== 'DISABLED' && u.id !== currentUserId ? (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem danger onClick={() => setConfirm({ kind: 'disable', user: u })}>
                            <ShieldOff className="h-4 w-4" />
                            Disable
                          </DropdownMenuItem>
                        </>
                      ) : null}
                      {canModify && u.id !== currentUserId ? (
                        <DropdownMenuItem danger onClick={() => setConfirm({ kind: 'delete', user: u })}>
                          <Trash2 className="h-4 w-4" />
                          Delete user
                        </DropdownMenuItem>
                      ) : null}
                      {!canApprove && !canModify ? (
                        <DropdownMenuItem disabled>
                          <UserX className="h-4 w-4" />
                          Read-only
                        </DropdownMenuItem>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* SSH access dialog */}
      <Dialog open={!!sshFor} onOpenChange={(o) => !o && (setSshFor(null), setSshDetails(null))}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-neon-green" />
              SSH access · {sshFor?.username}
            </DialogTitle>
            <DialogDescription>
              Provision a dedicated Linux account on the host for this panel user. The browser
              terminal will SSH as that account, so audit trails on the host show the real person.
            </DialogDescription>
          </DialogHeader>

          {!sshDetails ? (
            <div className="flex items-center gap-2 text-sm text-white/60">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-[10px] uppercase tracking-wider text-white/40">
                  Linux username on the host
                </label>
                <Input
                  value={sshDraft?.username ?? ''}
                  onChange={(e) =>
                    setSshDraft((d) => ({ ...(d ?? { username: '', sudo: false }), username: e.target.value }))
                  }
                  placeholder={sshDetails.suggestedUsername}
                  spellCheck={false}
                />
                <p className="mt-1 text-[11px] text-white/40">
                  Lowercase letters, digits, <code>_</code> and <code>-</code>. Suggestion uses a{' '}
                  <code>cp-</code> prefix to avoid system-account collisions.
                </p>
              </div>

              <label className="flex items-center justify-between rounded-lg border border-white/5 bg-white/[0.02] p-3">
                <div>
                  <div className="text-sm font-medium text-white">Passwordless sudo</div>
                  <div className="text-[11px] text-white/50">
                    Adds <code>{sshDraft?.username || '<user>'} ALL=(ALL) NOPASSWD: ALL</code> to{' '}
                    <code>/etc/sudoers.d/</code>. Recommended for trusted ADMINs.
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={!!sshDraft?.sudo}
                  onChange={(e) =>
                    setSshDraft((d) => ({ ...(d ?? { username: sshDetails.suggestedUsername, sudo: false }), sudo: e.target.checked }))
                  }
                  className="h-5 w-5 accent-neon-green"
                />
              </label>

              <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-[10px] uppercase tracking-wider text-white/40">Public key</div>
                  {sshDetails.publicKey ? (
                    <Button variant="ghost" size="sm" onClick={copyKey}>
                      <Copy className="h-3 w-3" />
                      Copy
                    </Button>
                  ) : null}
                </div>
                {sshDetails.publicKey ? (
                  <pre className="max-h-32 overflow-auto break-all whitespace-pre-wrap rounded bg-black/40 p-2 font-mono text-[10px] text-white/70">
                    {sshDetails.publicKey}
                  </pre>
                ) : (
                  <p className="text-xs text-white/50">
                    No keypair generated yet. Click <strong>Enable</strong> to generate one and provision the host account.
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="rounded border border-white/5 bg-white/[0.02] p-2">
                  <div className="text-[10px] uppercase tracking-wider text-white/40">Status</div>
                  <div className="mt-1 text-white">
                    {sshDetails.sshAccess && sshDetails.sshProvisioned ? (
                      <Badge tone="green">enabled</Badge>
                    ) : sshDetails.sshAccess ? (
                      <Badge tone="yellow">access on, not provisioned</Badge>
                    ) : (
                      <Badge tone="neutral">disabled</Badge>
                    )}
                  </div>
                </div>
                <div className="rounded border border-white/5 bg-white/[0.02] p-2">
                  <div className="text-[10px] uppercase tracking-wider text-white/40">Active sudo</div>
                  <div className="mt-1 text-white">
                    {sshDetails.sshSudo ? <Badge tone="magenta">yes</Badge> : <Badge tone="neutral">no</Badge>}
                  </div>
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            {sshDetails?.sshAccess ? (
              <>
                <Button variant="danger" disabled={sshBusy} onClick={deleteSsh}>
                  <Trash2 className="h-4 w-4" />
                  Delete host account
                </Button>
                <Button variant="outline" disabled={sshBusy} onClick={() => applySsh(false)}>
                  <ShieldOff className="h-4 w-4" />
                  Disable SSH
                </Button>
                <Button disabled={sshBusy} onClick={() => applySsh(true)}>
                  <Terminal className="h-4 w-4" />
                  {sshBusy ? 'Saving…' : 'Re-apply'}
                </Button>
              </>
            ) : (
              <>
                <Button variant="ghost" onClick={() => setSshFor(null)}>Cancel</Button>
                <Button disabled={sshBusy || !sshDraft?.username} onClick={() => applySsh(true)}>
                  <Terminal className="h-4 w-4" />
                  {sshBusy ? 'Provisioning…' : 'Enable SSH access'}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirm?.kind === 'disable' ? 'Disable user?' : confirm?.kind === 'delete' ? 'Delete user?' : 'Demote OWNER?'}
            </DialogTitle>
            <DialogDescription>
              {confirm?.kind === 'disable'
                ? `${confirm?.user.username} will lose all access immediately.`
                : confirm?.kind === 'delete'
                  ? `Permanently remove ${confirm?.user.username} from CachePanel. Their audit history will be preserved but unlinked.`
                  : `${confirm?.user.username} will be demoted to ADMIN.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={async () => {
                if (!confirm) return;
                const u = confirm.user;
                setConfirm(null);
                if (confirm.kind === 'disable') await disable(u);
                else if (confirm.kind === 'delete') await deleteUser(u);
                else await setRole(u, 'ADMIN');
              }}
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
