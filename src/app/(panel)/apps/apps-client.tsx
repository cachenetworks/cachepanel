'use client';

import * as React from 'react';
import Link from 'next/link';
import { ExternalLink, FileText, Play, Plus, RefreshCw, Square, Trash2 } from 'lucide-react';
import { Card, CardBody, CardHeader, CardSubtitle, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toaster';
import type { PanelUser } from '@/lib/session';

interface InstalledApp {
  id: string;
  slug: string;
  name: string;
  status: string;
  ports: Array<{ public: number; container: number }>;
  imageTag: string;
  hasUpdate: boolean;
  installedAt: string;
  server: { id: string; name: string; isPrimary: boolean };
}

function statusTone(status: string): 'green' | 'magenta' | 'yellow' | 'red' {
  if (status === 'running') return 'green';
  if (status === 'stopped') return 'yellow';
  if (status === 'failed') return 'red';
  return 'magenta';
}

export function AppsClient({ user }: { user: PanelUser }) {
  const { toast } = useToast();
  const [apps, setApps] = React.useState<InstalledApp[] | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [logs, setLogs] = React.useState<{ appId: string; text: string } | null>(null);

  const load = React.useCallback(async () => {
    try {
      const res = await fetch('/api/apps', { cache: 'no-store' });
      if (!res.ok) throw new Error(await res.text());
      const body = await res.json();
      setApps(body.apps);
    } catch (err) {
      toast({ variant: 'error', title: 'Failed to load apps', description: err instanceof Error ? err.message : String(err) });
    }
  }, [toast]);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function doAction(app: InstalledApp, action: 'start' | 'stop' | 'update' | 'logs') {
    setBusy(app.id);
    try {
      const res = await fetch(`/api/apps/${app.id}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Failed');
      if (action === 'logs') {
        setLogs({ appId: app.id, text: body.logs ?? '(no output)' });
      } else {
        toast({ variant: 'success', title: `${app.name} → ${action}` });
        await load();
      }
    } catch (err) {
      toast({ variant: 'error', title: `${action} failed`, description: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  }

  async function uninstall(app: InstalledApp) {
    if (!confirm(`Uninstall ${app.name}? All container volumes under its app directory will be deleted.`)) return;
    setBusy(app.id);
    try {
      const res = await fetch(`/api/apps/${app.id}`, { method: 'DELETE' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Failed');
      toast({ variant: 'success', title: `${app.name} uninstalled` });
      await load();
    } catch (err) {
      toast({ variant: 'error', title: 'Uninstall failed', description: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  }

  const canManage = user.role === 'OWNER' || user.role === 'ADMIN';

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-white">Apps</h1>
          <p className="text-xs text-white/50">
            One-click installs managed by CachePanel. Containers live under <code>/opt/cachepanel/apps/&lt;slug&gt;</code>.
          </p>
        </div>
        {canManage ? (
          <Link href="/apps/catalog">
            <Button>
              <Plus className="h-4 w-4" />
              Browse catalog
            </Button>
          </Link>
        ) : null}
      </div>

      {apps === null ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : apps.length === 0 ? (
        <Card>
          <CardBody>
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <p className="text-sm text-white/60">No apps installed yet.</p>
              {canManage ? (
                <Link href="/apps/catalog">
                  <Button>
                    <Plus className="h-4 w-4" />
                    Open the catalog
                  </Button>
                </Link>
              ) : null}
            </div>
          </CardBody>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {apps.map((app) => (
            <Card key={app.id}>
              <CardHeader>
                <div className="min-w-0">
                  <CardTitle>
                    <span className="truncate">{app.name}</span>
                    {app.hasUpdate ? (
                      <Badge tone="magenta" className="ml-2">
                        update
                      </Badge>
                    ) : null}
                  </CardTitle>
                  <CardSubtitle>
                    on <strong className="text-white/80">{app.server.name}</strong> · {app.imageTag || app.slug}
                  </CardSubtitle>
                </div>
                <Badge tone={statusTone(app.status)}>{app.status}</Badge>
              </CardHeader>
              <CardBody>
                <div className="flex flex-wrap items-center gap-1.5">
                  {app.ports.map((p) => (
                    <span
                      key={p.public}
                      className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-0.5 font-mono text-[11px] text-white/70"
                    >
                      :{p.public}
                    </span>
                  ))}
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {app.ports[0] ? (
                    <a
                      href={`http://${typeof window !== 'undefined' ? window.location.hostname : 'localhost'}:${app.ports[0].public}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Button variant="outline">
                        <ExternalLink className="h-3.5 w-3.5" />
                        Open
                      </Button>
                    </a>
                  ) : null}
                  <Button variant="outline" onClick={() => doAction(app, 'logs')} disabled={busy === app.id}>
                    <FileText className="h-3.5 w-3.5" />
                    Logs
                  </Button>
                  {canManage ? (
                    <>
                      {app.status === 'running' ? (
                        <Button variant="outline" onClick={() => doAction(app, 'stop')} disabled={busy === app.id}>
                          <Square className="h-3.5 w-3.5" />
                          Stop
                        </Button>
                      ) : (
                        <Button variant="outline" onClick={() => doAction(app, 'start')} disabled={busy === app.id}>
                          <Play className="h-3.5 w-3.5" />
                          Start
                        </Button>
                      )}
                      {app.hasUpdate ? (
                        <Button onClick={() => doAction(app, 'update')} disabled={busy === app.id}>
                          <RefreshCw className="h-3.5 w-3.5" />
                          Update
                        </Button>
                      ) : null}
                      <Button variant="danger" onClick={() => uninstall(app)} disabled={busy === app.id}>
                        <Trash2 className="h-3.5 w-3.5" />
                        Uninstall
                      </Button>
                    </>
                  ) : null}
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {logs ? (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4"
          onClick={() => setLogs(null)}
        >
          <div
            className="w-full max-w-4xl rounded-xl border border-neon-green/30 bg-bg-1 p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">Logs (last 200 lines)</h3>
              <Button variant="outline" onClick={() => setLogs(null)}>
                Close
              </Button>
            </div>
            <pre className="max-h-[60vh] overflow-auto rounded-md border border-white/10 bg-black/60 p-3 font-mono text-[11px] leading-relaxed text-white/85">
              {logs.text}
            </pre>
          </div>
        </div>
      ) : null}
    </div>
  );
}
