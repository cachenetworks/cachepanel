'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowLeft, Package, Search } from 'lucide-react';
import { Card, CardBody } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toaster';
import type { PanelUser } from '@/lib/session';

interface CatalogVar {
  name: string;
  label: string;
  type: 'string' | 'port' | 'password' | 'domain';
  default?: string;
  secret?: boolean;
  required?: boolean;
  description?: string;
}

interface CatalogApp {
  slug: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  defaultPort: number;
  latestImage: string;
  variables: CatalogVar[];
  links: { docs?: string; github?: string };
}

interface ServerSummary {
  id: string;
  name: string;
  isPrimary: boolean;
}

export function CatalogClient({ user }: { user: PanelUser }) {
  const { toast } = useToast();
  const [catalog, setCatalog] = React.useState<CatalogApp[] | null>(null);
  const [servers, setServers] = React.useState<ServerSummary[] | null>(null);
  const [query, setQuery] = React.useState('');
  const [category, setCategory] = React.useState<string>('all');
  const [installing, setInstalling] = React.useState<CatalogApp | null>(null);
  const canManage = user.role === 'OWNER' || user.role === 'ADMIN';

  React.useEffect(() => {
    (async () => {
      try {
        const [cRes, sRes] = await Promise.all([
          fetch('/api/apps/catalog', { cache: 'no-store' }),
          fetch('/api/servers', { cache: 'no-store' }),
        ]);
        if (!cRes.ok) throw new Error(await cRes.text());
        if (!sRes.ok) throw new Error(await sRes.text());
        const cBody = await cRes.json();
        const sBody = await sRes.json();
        setCatalog(cBody.apps);
        setServers(sBody.servers);
      } catch (err) {
        toast({ variant: 'error', title: 'Failed to load catalog', description: err instanceof Error ? err.message : String(err) });
      }
    })();
  }, [toast]);

  const categories = React.useMemo(() => {
    if (!catalog) return [] as string[];
    return Array.from(new Set(catalog.map((a) => a.category))).sort();
  }, [catalog]);

  const filtered = React.useMemo(() => {
    if (!catalog) return [];
    return catalog.filter((a) => {
      if (category !== 'all' && a.category !== category) return false;
      if (query && !`${a.name} ${a.description} ${a.slug}`.toLowerCase().includes(query.toLowerCase())) return false;
      return true;
    });
  }, [catalog, category, query]);

  return (
    <div className="space-y-5">
      <div>
        <Link href="/apps" className="inline-flex items-center gap-1 text-xs text-white/50 hover:text-white">
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to apps
        </Link>
        <h1 className="mt-2 text-xl font-semibold tracking-tight text-white">App catalog</h1>
        <p className="text-xs text-white/50">
          Click install, fill a couple fields, done. Each app drops a docker-compose.yml on the
          target server and starts it.
        </p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the catalog…"
            className="w-full rounded-md border border-white/10 bg-white/[0.03] py-2 pl-9 pr-3 text-sm text-white placeholder:text-white/30 focus:border-neon-magenta/50 focus:outline-none"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <CategoryPill active={category === 'all'} onClick={() => setCategory('all')}>
            all
          </CategoryPill>
          {categories.map((c) => (
            <CategoryPill key={c} active={category === c} onClick={() => setCategory(c)}>
              {c}
            </CategoryPill>
          ))}
        </div>
      </div>

      {catalog === null ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {filtered.map((app) => (
            <Card key={app.slug}>
              <CardBody>
                <div className="flex items-start gap-3">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-white/10 bg-white/[0.03] text-neon-magenta">
                    <Package className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate text-sm font-semibold text-white">{app.name}</h3>
                      <Badge tone="green">{app.category}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-white/55">{app.description}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {canManage ? (
                        <Button onClick={() => setInstalling(app)}>Install</Button>
                      ) : (
                        <span className="text-[11px] text-white/40">Install requires OWNER/ADMIN</span>
                      )}
                      {app.links.github ? (
                        <a
                          href={app.links.github}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[11px] text-white/50 underline-offset-4 hover:underline"
                        >
                          GitHub
                        </a>
                      ) : null}
                      {app.links.docs ? (
                        <a
                          href={app.links.docs}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[11px] text-white/50 underline-offset-4 hover:underline"
                        >
                          Docs
                        </a>
                      ) : null}
                    </div>
                  </div>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {installing && servers ? (
        <InstallModal
          app={installing}
          servers={servers}
          onClose={() => setInstalling(null)}
          onInstalled={() => setInstalling(null)}
        />
      ) : null}
    </div>
  );
}

function CategoryPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border px-2.5 py-1 text-[11px] uppercase tracking-wider transition-colors ${
        active
          ? 'border-neon-magenta/50 bg-neon-magenta/10 text-neon-magenta'
          : 'border-white/10 bg-white/[0.02] text-white/55 hover:border-white/25 hover:text-white'
      }`}
    >
      {children}
    </button>
  );
}

function InstallModal({
  app,
  servers,
  onClose,
  onInstalled,
}: {
  app: CatalogApp;
  servers: ServerSummary[];
  onClose: () => void;
  onInstalled: () => void;
}) {
  const { toast } = useToast();
  const [serverId, setServerId] = React.useState<string>(servers[0]?.id ?? '');
  const [vars, setVars] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(app.variables.map((v) => [v.name, v.default ?? ''])),
  );
  const [submitting, setSubmitting] = React.useState(false);

  async function submit() {
    if (!serverId) {
      toast({ variant: 'error', title: 'Pick a server' });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/apps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverId, slug: app.slug, variables: vars }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Failed');
      toast({ variant: 'success', title: `${app.name} installing…`, description: 'Container is pulling — refresh in a moment.' });
      onInstalled();
    } catch (err) {
      toast({ variant: 'error', title: 'Install failed', description: err instanceof Error ? err.message : String(err) });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-neon-magenta/30 bg-bg-1 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-white">Install {app.name}</h3>
        <p className="mt-1 text-xs text-white/55">{app.description}</p>

        <div className="mt-4 space-y-3">
          <Field label="Target server">
            <select
              value={serverId}
              onChange={(e) => setServerId(e.target.value)}
              className="w-full rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white focus:border-neon-magenta/50 focus:outline-none"
            >
              {servers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.isPrimary ? ' (primary)' : ''}
                </option>
              ))}
            </select>
          </Field>

          {app.variables.map((v) => (
            <Field key={v.name} label={v.label} description={v.description}>
              <input
                type={v.secret ? 'password' : v.type === 'port' ? 'number' : 'text'}
                value={vars[v.name] ?? ''}
                onChange={(e) => setVars({ ...vars, [v.name]: e.target.value })}
                placeholder={v.default ?? (v.required ? 'required' : 'optional')}
                className="w-full rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-neon-magenta/50 focus:outline-none"
              />
              {v.secret ? (
                <p className="mt-1 text-[10px] text-white/40">Leave blank to auto-generate.</p>
              ) : null}
            </Field>
          ))}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? 'Installing…' : `Install ${app.name}`}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-white/70">{label}</span>
      {children}
      {description ? <p className="mt-1 text-[10px] text-white/40">{description}</p> : null}
    </label>
  );
}
