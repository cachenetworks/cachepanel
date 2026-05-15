'use client';

import * as React from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Pencil,
  Plug,
  Plus,
  RefreshCw,
  Save,
  Server as ServerIcon,
  Trash2,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toaster';
import { useServer } from '@/components/layout/server-context';
import { cn } from '@/lib/utils';
import { AddServerWizard } from './add-server-wizard';
import { Sparkles } from 'lucide-react';

interface ServerRow {
  id: string;
  name: string;
  hostname: string;
  port: number;
  defaultUser: string;
  keyName: string;
  knownHostsName: string;
  tags: string;
  isPrimary: boolean;
  notes: string | null;
  createdAt: string;
}

export function ServersClient({ role }: { role: 'OWNER' | 'ADMIN' }) {
  const { toast } = useToast();
  const { refresh: refreshServerCtx } = useServer();
  const [rows, setRows] = React.useState<ServerRow[] | null>(null);
  const [editing, setEditing] = React.useState<ServerRow | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState<ServerRow | null>(null);
  const [testing, setTesting] = React.useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = React.useState(false);
  const isOwner = role === 'OWNER';

  const load = React.useCallback(async () => {
    try {
      const r = await fetch('/api/servers', { cache: 'no-store' });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? `Failed (${r.status})`);
      setRows(body.servers);
      refreshServerCtx();
    } catch (err) {
      toast({ variant: 'error', title: 'Load failed', description: err instanceof Error ? err.message : String(err) });
    }
  }, [toast, refreshServerCtx]);

  React.useEffect(() => {
    load();
  }, [load]);

  async function testServer(s: ServerRow) {
    setTesting(s.id);
    try {
      const r = await fetch(`/api/servers/${s.id}/test`, { method: 'POST' });
      const body = await r.json();
      if (body.ok) {
        toast({ variant: 'success', title: `${s.name} reachable`, description: `${body.durationMs}ms · ${(body.output ?? '').split('\n')[0]}` });
      } else {
        toast({ variant: 'error', title: `${s.name} unreachable`, description: body.error });
      }
    } catch (err) {
      toast({ variant: 'error', title: 'Test failed', description: err instanceof Error ? err.message : String(err) });
    } finally {
      setTesting(null);
    }
  }

  async function deleteServer() {
    if (!confirmDelete) return;
    try {
      const r = await fetch(`/api/servers/${confirmDelete.id}`, { method: 'DELETE' });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error ?? `Failed (${r.status})`);
      toast({ variant: 'success', title: 'Server deleted' });
      setConfirmDelete(null);
      load();
    } catch (err) {
      toast({ variant: 'error', title: 'Delete failed', description: err instanceof Error ? err.message : String(err) });
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-white">
            <ServerIcon className="h-5 w-5 text-neon-green" />
            Servers
          </h1>
          <p className="text-xs text-white/50">
            Hosts CachePanel can manage. The browser switcher (top-right) chooses which one is active.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={load}>
            <RefreshCw className="h-3 w-3" />
            Refresh
          </Button>
          {isOwner ? (
            <>
              <Button size="sm" variant="magenta" onClick={() => setWizardOpen(true)}>
                <Sparkles className="h-3 w-3" />
                Guided setup
              </Button>
              <Button size="sm" variant="outline" onClick={() => { setCreating(true); setEditing(null); }}>
                <Plus className="h-3 w-3" />
                Manual add
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {rows && rows.length === 1 && rows[0]?.isPrimary && isOwner ? (
        <Card className="border-neon-magenta/30 bg-neon-magenta/5">
          <div className="flex items-start gap-3">
            <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-neon-magenta" />
            <div className="text-sm">
              <div className="font-medium text-white">Add a second server in two steps</div>
              <p className="mt-1 text-xs text-white/60">
                CachePanel can manage as many remote machines as you like — one click and a copy/paste on the
                remote box gets you connected. Click <strong>Guided setup</strong> above to walk through it.
              </p>
            </div>
          </div>
        </Card>
      ) : null}

      <Card className="p-0">
        {rows === null ? (
          <div className="space-y-2 p-5">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<ServerIcon className="h-8 w-8" />}
            title="No servers"
            description={isOwner ? 'Add one above.' : 'No servers configured yet.'}
          />
        ) : (
          <div className="divide-y divide-white/[0.04]">
            <div className="grid grid-cols-[1.4fr_1.2fr_1fr_120px_180px] gap-3 px-5 py-3 text-[10px] uppercase tracking-wider text-white/40">
              <div>Name</div>
              <div>Hostname</div>
              <div>Default user</div>
              <div>Tags</div>
              <div className="text-right">Actions</div>
            </div>
            {rows.map((s) => (
              <div key={s.id} className="grid grid-cols-[1.4fr_1.2fr_1fr_120px_180px] items-center gap-3 px-5 py-3 hover:bg-white/[0.03]">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 truncate text-sm font-medium text-white">
                    <ServerIcon className={cn('h-3.5 w-3.5', s.isPrimary ? 'text-neon-green' : 'text-white/40')} />
                    {s.name}
                    {s.isPrimary ? <Badge tone="green">primary</Badge> : null}
                  </div>
                  {s.notes ? <div className="truncate text-[11px] text-white/40">{s.notes}</div> : null}
                </div>
                <div className="truncate font-mono text-xs text-white/70">{s.hostname}:{s.port}</div>
                <div className="truncate text-xs text-white/70">{s.defaultUser}</div>
                <div className="flex flex-wrap gap-1">
                  {s.tags
                    .split(',')
                    .map((t) => t.trim())
                    .filter(Boolean)
                    .slice(0, 3)
                    .map((t) => (
                      <span key={t} className="rounded border border-white/10 bg-white/[0.02] px-1.5 py-0.5 text-[10px] text-white/60">
                        {t}
                      </span>
                    ))}
                </div>
                <div className="flex items-center justify-end gap-1">
                  <Button variant="outline" size="sm" disabled={testing === s.id} onClick={() => testServer(s)}>
                    {testing === s.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plug className="h-3 w-3" />}
                    Test
                  </Button>
                  {isOwner ? (
                    <Button variant="ghost" size="sm" onClick={() => { setEditing(s); setCreating(false); }}>
                      <Pencil className="h-3 w-3" />
                    </Button>
                  ) : null}
                  {isOwner && !s.isPrimary ? (
                    <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(s)}>
                      <Trash2 className="h-3 w-3 text-red-400" />
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3 text-xs text-white/50">
        <strong className="text-white/70">Add a new server:</strong> generate an SSH key inside <code>./secrets/</code>,
        copy the matching public key into <code>~/.ssh/authorized_keys</code> on the remote box, capture its host key
        with <code>ssh-keyscan</code>, then add a row here pointing at the right key/known_hosts file. The provisioning
        script can then be used per-(user, server) from the Users page.
      </div>

      <AddServerWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onCreated={() => { load(); }}
      />

      <ServerDialog
        open={creating || !!editing}
        existing={editing}
        onClose={() => { setCreating(false); setEditing(null); }}
        afterSave={() => { setCreating(false); setEditing(null); load(); }}
      />

      <Dialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash2 className="h-4 w-4 text-red-400" />
              Delete server?
            </DialogTitle>
            <DialogDescription>
              {confirmDelete?.name} ({confirmDelete?.hostname}) will be removed from CachePanel. The remote machine
              itself is untouched. Per-user provisioning rows for this server are deleted too.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button variant="danger" onClick={deleteServer}>
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ServerDialog({
  open,
  existing,
  onClose,
  afterSave,
}: {
  open: boolean;
  existing: ServerRow | null;
  onClose: () => void;
  afterSave: () => void;
}) {
  const { toast } = useToast();
  const [draft, setDraft] = React.useState<{
    name: string;
    hostname: string;
    port: number;
    defaultUser: string;
    keyName: string;
    knownHostsName: string;
    tags: string;
    notes: string;
  } | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setDraft(
      existing
        ? {
            name: existing.name,
            hostname: existing.hostname,
            port: existing.port,
            defaultUser: existing.defaultUser,
            keyName: existing.keyName,
            knownHostsName: existing.knownHostsName,
            tags: existing.tags,
            notes: existing.notes ?? '',
          }
        : {
            name: '',
            hostname: '',
            port: 22,
            defaultUser: 'cache',
            keyName: 'cachepanel_id_ed25519',
            knownHostsName: 'known_hosts',
            tags: '',
            notes: '',
          },
    );
  }, [open, existing]);

  if (!draft) return null;

  async function save() {
    if (!draft) return;
    setBusy(true);
    try {
      const r = await fetch(existing ? `/api/servers/${existing.id}` : '/api/servers', {
        method: existing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error ?? `Failed (${r.status})`);
      toast({ variant: 'success', title: existing ? 'Server updated' : 'Server added' });
      afterSave();
    } catch (err) {
      toast({ variant: 'error', title: 'Save failed', description: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{existing ? 'Edit server' : 'Add server'}</DialogTitle>
          <DialogDescription>
            The SSH keypair must already exist in <code>./secrets/</code> on the panel host, and the matching public key
            installed in <code>~/.ssh/authorized_keys</code> on this server.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name" full>
            <Input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value.toLowerCase() })}
              placeholder="us-east-vps"
              disabled={!!existing?.isPrimary}
            />
          </Field>
          <Field label="Hostname" full>
            <Input
              value={draft.hostname}
              onChange={(e) => setDraft({ ...draft, hostname: e.target.value })}
              placeholder="vps.example.com or 1.2.3.4"
              className="font-mono"
            />
          </Field>
          <Field label="Port">
            <Input
              type="number"
              value={draft.port}
              onChange={(e) => setDraft({ ...draft, port: parseInt(e.target.value || '22', 10) })}
            />
          </Field>
          <Field label="Default SSH user">
            <Input
              value={draft.defaultUser}
              onChange={(e) => setDraft({ ...draft, defaultUser: e.target.value })}
              placeholder="cache"
            />
          </Field>
          <Field label="Private key filename (in ./secrets/)">
            <Input
              value={draft.keyName}
              onChange={(e) => setDraft({ ...draft, keyName: e.target.value })}
              className="font-mono"
            />
          </Field>
          <Field label="known_hosts filename (in ./secrets/)">
            <Input
              value={draft.knownHostsName}
              onChange={(e) => setDraft({ ...draft, knownHostsName: e.target.value })}
              className="font-mono"
            />
          </Field>
          <Field label="Tags (comma-separated)" full>
            <Input
              value={draft.tags}
              onChange={(e) => setDraft({ ...draft, tags: e.target.value })}
              placeholder="prod, lab"
            />
          </Field>
          <Field label="Notes" full>
            <Textarea
              rows={2}
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              className="min-h-[60px]"
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={busy || !draft.name.trim() || !draft.hostname.trim() || !draft.defaultUser.trim()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {existing ? 'Save changes' : 'Add server'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, full, children }: { label: string; full?: boolean; children: React.ReactNode }) {
  return (
    <label className={cn('flex flex-col gap-1', full ? 'col-span-2' : '')}>
      <span className="text-[10px] uppercase tracking-wider text-white/40">{label}</span>
      {children}
    </label>
  );
}
