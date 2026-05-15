'use client';

import * as React from 'react';
import {
  AlertTriangle,
  Cloud,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Settings as SettingsIcon,
  Trash2,
  X,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { formatRelative } from '@/lib/utils';
import { cn } from '@/lib/utils';

interface Tunnel {
  id: string;
  name: string;
  status: string;
  created_at: string;
  deleted_at: string | null;
  connections: Array<{ colo_name?: string; opened_at?: string; origin_ip?: string }>;
}

interface IngressRule {
  hostname?: string;
  service: string;
  path?: string;
}

interface TunnelConfig {
  config?: { ingress?: IngressRule[] };
}

const statusTone: Record<string, 'green' | 'yellow' | 'red' | 'neutral'> = {
  healthy: 'green',
  degraded: 'yellow',
  inactive: 'neutral',
  down: 'red',
};

export function TunnelsClient({ role }: { role: 'OWNER' | 'ADMIN' }) {
  const { toast } = useToast();
  const [configured, setConfigured] = React.useState<boolean | null>(null);
  const [tunnels, setTunnels] = React.useState<Tunnel[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [newName, setNewName] = React.useState('');
  const [createBusy, setCreateBusy] = React.useState(false);
  const [createdToken, setCreatedToken] = React.useState<{ name: string; id: string; token: string } | null>(null);
  const [revealToken, setRevealToken] = React.useState(false);
  const [showToken, setShowToken] = React.useState<{ id: string; name: string; token: string } | null>(null);
  const [configFor, setConfigFor] = React.useState<Tunnel | null>(null);
  const [configRules, setConfigRules] = React.useState<IngressRule[]>([]);
  const [originalHostnames, setOriginalHostnames] = React.useState<string[]>([]);
  const [configBusy, setConfigBusy] = React.useState(false);
  const [deleteFor, setDeleteFor] = React.useState<Tunnel | null>(null);

  const isOwner = role === 'OWNER';

  const load = React.useCallback(async () => {
    try {
      const r = await fetch('/api/cloudflare/tunnels', { cache: 'no-store' });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? `Failed (${r.status})`);
      setConfigured(!!body.configured);
      setTunnels(body.tunnels ?? []);
      setError(body.error ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  async function createTunnel() {
    if (!newName.trim() || createBusy) return;
    setCreateBusy(true);
    try {
      const r = await fetch('/api/cloudflare/tunnels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? `Failed (${r.status})`);
      const t = body.tunnel;
      setCreating(false);
      setNewName('');
      if (t.token) {
        setCreatedToken({ id: t.id, name: t.name, token: t.token });
        setRevealToken(false);
      }
      toast({ variant: 'success', title: 'Tunnel created', description: t.name });
      load();
    } catch (err) {
      toast({ variant: 'error', title: 'Create failed', description: err instanceof Error ? err.message : String(err) });
    } finally {
      setCreateBusy(false);
    }
  }

  async function fetchToken(t: Tunnel) {
    try {
      const r = await fetch(`/api/cloudflare/tunnels/${t.id}/token`, { cache: 'no-store' });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? `Failed (${r.status})`);
      setShowToken({ id: t.id, name: t.name, token: body.token });
      setRevealToken(false);
    } catch (err) {
      toast({ variant: 'error', title: 'Token fetch failed', description: err instanceof Error ? err.message : String(err) });
    }
  }

  async function deleteTunnel() {
    if (!deleteFor) return;
    try {
      const r = await fetch(`/api/cloudflare/tunnels/${deleteFor.id}`, { method: 'DELETE' });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error ?? `Failed (${r.status})`);
      toast({ variant: 'success', title: 'Tunnel deleted' });
      setDeleteFor(null);
      load();
    } catch (err) {
      toast({ variant: 'error', title: 'Delete failed', description: err instanceof Error ? err.message : String(err) });
    }
  }

  async function openConfig(t: Tunnel) {
    setConfigFor(t);
    setConfigRules([]);
    setOriginalHostnames([]);
    try {
      const r = await fetch(`/api/cloudflare/tunnels/${t.id}/config`, { cache: 'no-store' });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? `Failed (${r.status})`);
      const ingress = (body.config?.config?.ingress ?? []) as IngressRule[];
      // Strip the trailing http_status:404 catch-all from the editor — we'll add it back on save.
      const editable = ingress.filter((r, i) => !(i === ingress.length - 1 && r.service === 'http_status:404'));
      setConfigRules(editable);
      setOriginalHostnames(editable.map((r) => r.hostname).filter((h): h is string => !!h));
    } catch (err) {
      toast({ variant: 'error', title: 'Config load failed', description: err instanceof Error ? err.message : String(err) });
    }
  }

  async function saveConfig() {
    if (!configFor) return;
    setConfigBusy(true);
    try {
      const cleaned = configRules
        .filter((r) => r.service.trim())
        .map((r) => ({
          hostname: r.hostname?.trim() || undefined,
          service: r.service.trim(),
          path: r.path?.trim() || undefined,
        }));
      const newHosts = new Set(cleaned.map((r) => r.hostname).filter(Boolean) as string[]);
      const removed = originalHostnames.filter((h) => !newHosts.has(h));
      const r = await fetch(`/api/cloudflare/tunnels/${configFor.id}/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ingress: cleaned, removeHostnames: removed }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? `Failed (${r.status})`);
      const dnsErrs = (body.dns ?? []).filter((d: { ok: boolean }) => !d.ok);
      if (dnsErrs.length) {
        toast({
          variant: 'info',
          title: 'Config saved, some DNS warnings',
          description: dnsErrs.map((e: { hostname: string; error: string }) => `${e.hostname}: ${e.error}`).join(' · '),
        });
      } else {
        toast({ variant: 'success', title: 'Tunnel config saved' });
      }
      setConfigFor(null);
    } catch (err) {
      toast({ variant: 'error', title: 'Save failed', description: err instanceof Error ? err.message : String(err) });
    } finally {
      setConfigBusy(false);
    }
  }

  function copy(text: string) {
    navigator.clipboard.writeText(text).then(
      () => toast({ variant: 'success', title: 'Copied' }),
      () => toast({ variant: 'error', title: 'Copy failed' }),
    );
  }

  if (configured === false) {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-white">
            <Cloud className="h-5 w-5 text-neon-magenta" />
            Cloudflare Tunnels
          </h1>
        </div>
        <Card>
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-yellow-300" />
            <div className="text-sm">
              <div className="font-medium text-white">Cloudflare API is not configured</div>
              <p className="mt-1 text-xs text-white/60">
                Set <code className="text-neon-green">CLOUDFLARE_API_TOKEN</code> and{' '}
                <code className="text-neon-green">CLOUDFLARE_ACCOUNT_ID</code> in your <code>.env</code>, then
                recreate the container:
              </p>
              <pre className="mt-2 rounded bg-black/40 p-2 font-mono text-[11px] text-white/70">
                {`docker compose up -d --force-recreate app`}
              </pre>
              <p className="mt-2 text-xs text-white/60">
                Create a token at{' '}
                <a
                  className="text-neon-magenta underline"
                  href="https://dash.cloudflare.com/profile/api-tokens"
                  target="_blank"
                  rel="noreferrer"
                >
                  cloudflare.com/profile/api-tokens
                </a>{' '}
                with <strong>Account · Cloudflare Tunnel · Edit</strong> and{' '}
                <strong>Zone · DNS · Edit</strong>.
              </p>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-white">
            <Cloud className="h-5 w-5 text-neon-magenta" />
            Cloudflare Tunnels
          </h1>
          <p className="text-xs text-white/50">List, create, configure ingress rules, manage DNS records.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={load}>
            <RefreshCw className="h-3 w-3" />
            Refresh
          </Button>
          {isOwner ? (
            <Button size="sm" variant="magenta" onClick={() => setCreating(true)}>
              <Plus className="h-3 w-3" />
              New tunnel
            </Button>
          ) : null}
        </div>
      </div>

      {error ? (
        <Card>
          <div className="flex items-start gap-2 text-sm text-red-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        </Card>
      ) : null}

      <Card className="p-0">
        {tunnels === null ? (
          <div className="space-y-2 p-5">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : tunnels.length === 0 ? (
          <EmptyState
            icon={<Cloud className="h-8 w-8" />}
            title="No tunnels"
            description={isOwner ? 'Create your first tunnel.' : 'OWNER hasn\'t made any tunnels.'}
          />
        ) : (
          <div className="divide-y divide-white/[0.04]">
            <div className="grid grid-cols-[1.5fr_100px_1.5fr_140px_140px] gap-3 px-5 py-3 text-[10px] uppercase tracking-wider text-white/40">
              <div>Name</div>
              <div>Status</div>
              <div>Connections</div>
              <div>Created</div>
              <div className="text-right">Actions</div>
            </div>
            {tunnels.map((t) => (
              <div key={t.id} className="grid grid-cols-[1.5fr_100px_1.5fr_140px_140px] items-center gap-3 px-5 py-3 hover:bg-white/[0.03]">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-white">{t.name}</div>
                  <div className="font-mono text-[10px] text-white/40">{t.id}</div>
                </div>
                <div>
                  <Badge tone={statusTone[t.status] ?? 'neutral'}>{t.status}</Badge>
                </div>
                <div className="truncate text-xs text-white/60">
                  {t.connections.length === 0
                    ? <span className="text-white/30">no connectors</span>
                    : t.connections.map((c) => `${c.colo_name ?? '?'}`).join(' · ')}
                </div>
                <div className="text-xs text-white/40">{formatRelative(t.created_at)}</div>
                <div className="flex items-center justify-end gap-1">
                  <Button variant="outline" size="sm" onClick={() => openConfig(t)} title="Edit ingress">
                    <SettingsIcon className="h-3 w-3" />
                  </Button>
                  {isOwner ? (
                    <Button variant="outline" size="sm" onClick={() => fetchToken(t)} title="Show connector token">
                      <Eye className="h-3 w-3" />
                    </Button>
                  ) : null}
                  {isOwner ? (
                    <Button variant="ghost" size="sm" onClick={() => setDeleteFor(t)} title="Delete">
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
        <strong className="text-white/70">Run a tunnel:</strong> after creating, copy the token and run on the host:
        <pre className="mt-2 rounded bg-black/40 p-2 font-mono text-[11px] text-neon-magenta">
          {`cloudflared tunnel run --token <token>`}
        </pre>
      </div>

      {/* Create dialog */}
      <Dialog open={creating} onOpenChange={(o) => !o && setCreating(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New tunnel</DialogTitle>
            <DialogDescription>Pick a name. You&apos;ll get a token to run cloudflared with.</DialogDescription>
          </DialogHeader>
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="my-tunnel" autoFocus />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
            <Button variant="magenta" onClick={createTunnel} disabled={createBusy || !newName.trim()}>
              {createBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Token (just-created) */}
      <TokenDialog
        open={!!createdToken}
        onClose={() => setCreatedToken(null)}
        title={`Tunnel created: ${createdToken?.name ?? ''}`}
        token={createdToken?.token ?? ''}
        reveal={revealToken}
        onToggleReveal={() => setRevealToken((v) => !v)}
        onCopy={(t) => copy(t)}
        firstTime
      />

      {/* Token (existing tunnel) */}
      <TokenDialog
        open={!!showToken}
        onClose={() => setShowToken(null)}
        title={`Connector token · ${showToken?.name ?? ''}`}
        token={showToken?.token ?? ''}
        reveal={revealToken}
        onToggleReveal={() => setRevealToken((v) => !v)}
        onCopy={(t) => copy(t)}
      />

      {/* Delete */}
      <Dialog open={!!deleteFor} onOpenChange={(o) => !o && setDeleteFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash2 className="h-4 w-4 text-red-400" />
              Delete tunnel?
            </DialogTitle>
            <DialogDescription>
              {deleteFor?.name} will be removed from Cloudflare. Any cloudflared connector running with its token will go offline.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteFor(null)}>Cancel</Button>
            <Button variant="danger" onClick={deleteTunnel}>
              <Trash2 className="h-4 w-4" /> Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Ingress config */}
      <Dialog open={!!configFor} onOpenChange={(o) => !o && setConfigFor(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <SettingsIcon className="h-4 w-4 text-neon-green" />
              Ingress · {configFor?.name}
            </DialogTitle>
            <DialogDescription>
              Map public hostnames to local services. CachePanel will also create the matching CNAME records.
              A catch-all <code>http_status:404</code> rule is appended automatically.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            {configRules.length === 0 ? (
              <p className="text-xs text-white/50">No rules yet — add one below.</p>
            ) : null}
            {configRules.map((rule, idx) => (
              <div key={idx} className="grid grid-cols-[1.4fr_1.4fr_60px_40px] items-center gap-2">
                <Input
                  value={rule.hostname ?? ''}
                  onChange={(e) =>
                    setConfigRules((rs) => rs.map((r, i) => (i === idx ? { ...r, hostname: e.target.value } : r)))
                  }
                  placeholder="panel.example.com"
                />
                <Input
                  value={rule.service}
                  onChange={(e) =>
                    setConfigRules((rs) => rs.map((r, i) => (i === idx ? { ...r, service: e.target.value } : r)))
                  }
                  placeholder="http://localhost:8992"
                  className="font-mono text-xs"
                />
                <Input
                  value={rule.path ?? ''}
                  onChange={(e) =>
                    setConfigRules((rs) => rs.map((r, i) => (i === idx ? { ...r, path: e.target.value } : r)))
                  }
                  placeholder="/path"
                />
                <Button variant="ghost" size="icon" onClick={() => setConfigRules((rs) => rs.filter((_, i) => i !== idx))}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfigRules((rs) => [...rs, { hostname: '', service: 'http://localhost:8080' }])}
            >
              <Plus className="h-3 w-3" /> Add rule
            </Button>
          </div>

          <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3 text-[11px] text-white/50">
            <strong className="text-white/70">Service formats:</strong>{' '}
            <code>http://host:port</code>, <code>https://host:port</code>, <code>tcp://host:port</code>,{' '}
            <code>http_status:404</code>, <code>hello_world</code>.{' '}
            <a
              className="text-neon-magenta underline"
              href="https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/configure-tunnels/local-management/ingress/"
              target="_blank"
              rel="noreferrer"
            >
              docs <ExternalLink className="inline h-3 w-3" />
            </a>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfigFor(null)}>Cancel</Button>
            <Button onClick={saveConfig} disabled={configBusy || !isOwner}>
              {configBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {isOwner ? 'Save' : 'OWNER only'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TokenDialog({
  open,
  onClose,
  title,
  token,
  reveal,
  onToggleReveal,
  onCopy,
  firstTime,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  token: string;
  reveal: boolean;
  onToggleReveal: () => void;
  onCopy: (t: string) => void;
  firstTime?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {firstTime
              ? 'Save this token now — it grants permission to run a connector for this tunnel.'
              : 'Use this token with cloudflared to start the connector.'}
          </DialogDescription>
        </DialogHeader>
        <pre
          className={cn(
            'max-h-40 overflow-auto rounded border border-white/10 bg-black/60 p-3 font-mono text-[11px] text-white/80',
            !reveal && 'select-none blur-sm',
          )}
        >
          {token}
        </pre>
        <pre className="rounded border border-white/5 bg-white/[0.02] p-2 text-[11px] text-neon-magenta">
          cloudflared tunnel run --token {reveal ? token.slice(0, 18) + '…' : '<token>'}
        </pre>
        <DialogFooter>
          <Button variant="ghost" onClick={onToggleReveal}>
            {reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            {reveal ? 'Hide' : 'Reveal'}
          </Button>
          <Button onClick={() => onCopy(token)}>
            <Copy className="h-4 w-4" />
            Copy token
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
