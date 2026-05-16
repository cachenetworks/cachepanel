'use client';

import * as React from 'react';
import { Layers, Loader2, Play, Server } from 'lucide-react';
import { Card, CardBody, CardHeader, CardSubtitle, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toaster';
import type { PanelUser } from '@/lib/session';

type ActionId = 'restart-container' | 'pull-image' | 'compose-up' | 'compose-down' | 'custom-safe';

interface ServerSummary {
  id: string;
  name: string;
  hostname: string;
  isPrimary: boolean;
  tags?: string;
}

interface BatchResult {
  serverId: string;
  serverName: string;
  code: number;
  stdout: string;
  stderr: string;
}

const ACTIONS: Array<{ id: ActionId; label: string; needs: string[] }> = [
  { id: 'restart-container', label: 'Restart container', needs: ['containerName'] },
  { id: 'pull-image', label: 'Pull image', needs: ['containerName'] },
  { id: 'compose-up', label: 'docker compose up -d', needs: ['composeDir'] },
  { id: 'compose-down', label: 'docker compose down', needs: ['composeDir'] },
  { id: 'custom-safe', label: 'Run safe command', needs: ['customCommand'] },
];

const SAFE_CUSTOMS = ['df -h', 'uptime', 'docker ps', 'free -h', 'systemctl status docker'];

export function BatchClient({ user }: { user: PanelUser }) {
  const { toast } = useToast();
  const [servers, setServers] = React.useState<ServerSummary[] | null>(null);
  const [tags, setTags] = React.useState<string[]>([]);
  const [selectMode, setSelectMode] = React.useState<'servers' | 'tag'>('servers');
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [tag, setTag] = React.useState('');
  const [action, setAction] = React.useState<ActionId>('restart-container');
  const [containerName, setContainerName] = React.useState('');
  const [composeDir, setComposeDir] = React.useState('/opt/cachepanel');
  const [customCommand, setCustomCommand] = React.useState(SAFE_CUSTOMS[0]!);
  const [running, setRunning] = React.useState(false);
  const [results, setResults] = React.useState<BatchResult[] | null>(null);

  const canRun = user.role === 'OWNER' || user.role === 'ADMIN';

  React.useEffect(() => {
    (async () => {
      try {
        const [sRes, tRes] = await Promise.all([
          fetch('/api/servers', { cache: 'no-store' }),
          fetch('/api/servers/batch', { cache: 'no-store' }),
        ]);
        if (!sRes.ok) throw new Error(await sRes.text());
        if (!tRes.ok) throw new Error(await tRes.text());
        const sBody = await sRes.json();
        const tBody = await tRes.json();
        setServers(sBody.servers);
        setTags(tBody.tags ?? []);
      } catch (err) {
        toast({ variant: 'error', title: 'Load failed', description: err instanceof Error ? err.message : String(err) });
      }
    })();
  }, [toast]);

  function toggleServer(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  }

  async function run() {
    setRunning(true);
    setResults(null);
    try {
      const body: Record<string, unknown> = { action };
      if (selectMode === 'servers') {
        if (selectedIds.size === 0) throw new Error('Pick at least one server');
        body.serverIds = Array.from(selectedIds);
      } else {
        if (!tag) throw new Error('Pick a tag');
        body.tag = tag;
      }
      if (action === 'restart-container' || action === 'pull-image') body.containerName = containerName;
      if (action === 'compose-up' || action === 'compose-down') body.composeDir = composeDir;
      if (action === 'custom-safe') body.customCommand = customCommand;

      const res = await fetch('/api/servers/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const respBody = await res.json();
      if (!res.ok) throw new Error(respBody.error ?? 'Batch failed');
      setResults(respBody.results);
      toast({
        variant: respBody.successCount === respBody.totalServers ? 'success' : 'error',
        title: `${respBody.successCount}/${respBody.totalServers} succeeded`,
      });
    } catch (err) {
      toast({ variant: 'error', title: 'Run failed', description: err instanceof Error ? err.message : String(err) });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-white">
          <Layers className="h-5 w-5 text-neon-magenta" />
          Batch actions
        </h1>
        <p className="text-xs text-white/50">
          Run a whitelisted action across multiple servers at once. Pick servers individually or by
          tag.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>1 · Pick servers</CardTitle>
            <CardSubtitle>{selectMode === 'servers' ? `${selectedIds.size} selected` : `tag: ${tag || '(none)'}`}</CardSubtitle>
          </div>
        </CardHeader>
        <CardBody>
          <div className="mb-3 flex gap-1">
            <ModePill active={selectMode === 'servers'} onClick={() => setSelectMode('servers')}>
              By server
            </ModePill>
            <ModePill active={selectMode === 'tag'} onClick={() => setSelectMode('tag')}>
              By tag
            </ModePill>
          </div>

          {selectMode === 'servers' ? (
            servers === null ? (
              <Skeleton className="h-32 w-full" />
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {servers.map((s) => (
                  <label
                    key={s.id}
                    className="flex items-center gap-3 rounded-md border border-white/5 bg-white/[0.02] p-2.5"
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.has(s.id)}
                      onChange={() => toggleServer(s.id)}
                    />
                    <Server className="h-3.5 w-3.5 text-white/40" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-xs font-medium text-white">
                        {s.name}
                        {s.isPrimary ? <Badge tone="magenta">primary</Badge> : null}
                      </div>
                      <div className="truncate text-[10px] text-white/40">{s.hostname}</div>
                    </div>
                  </label>
                ))}
              </div>
            )
          ) : tags.length === 0 ? (
            <p className="rounded-md border border-white/10 bg-white/[0.02] p-3 text-xs text-white/55">
              No tags defined yet. Add tags on a server's edit screen first.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1">
              {tags.map((t) => (
                <button
                  key={t}
                  onClick={() => setTag(t)}
                  className={`rounded-md border px-2.5 py-1 text-[11px] uppercase tracking-wider transition-colors ${
                    tag === t
                      ? 'border-neon-magenta/50 bg-neon-magenta/10 text-neon-magenta'
                      : 'border-white/10 text-white/55 hover:border-white/25 hover:text-white'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>2 · Pick the action</CardTitle>
            <CardSubtitle>only whitelisted ops — no raw shell</CardSubtitle>
          </div>
        </CardHeader>
        <CardBody className="space-y-3">
          <select
            value={action}
            onChange={(e) => setAction(e.target.value as ActionId)}
            className="w-full rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white focus:border-neon-magenta/50 focus:outline-none"
          >
            {ACTIONS.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
          {(action === 'restart-container' || action === 'pull-image') ? (
            <input
              value={containerName}
              onChange={(e) => setContainerName(e.target.value)}
              placeholder={action === 'pull-image' ? 'image (e.g. nginx:1.27)' : 'container name'}
              className="w-full rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 font-mono text-xs text-white focus:border-neon-magenta/50 focus:outline-none"
            />
          ) : null}
          {(action === 'compose-up' || action === 'compose-down') ? (
            <input
              value={composeDir}
              onChange={(e) => setComposeDir(e.target.value)}
              placeholder="/opt/myapp"
              className="w-full rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 font-mono text-xs text-white focus:border-neon-magenta/50 focus:outline-none"
            />
          ) : null}
          {action === 'custom-safe' ? (
            <select
              value={customCommand}
              onChange={(e) => setCustomCommand(e.target.value)}
              className="w-full rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 font-mono text-xs text-white focus:border-neon-magenta/50 focus:outline-none"
            >
              {SAFE_CUSTOMS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          ) : null}
          <Button onClick={run} disabled={running || !canRun}>
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {running ? 'Running…' : 'Run on selected servers'}
          </Button>
        </CardBody>
      </Card>

      {results ? (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Results</CardTitle>
              <CardSubtitle>{results.length} server{results.length === 1 ? '' : 's'}</CardSubtitle>
            </div>
          </CardHeader>
          <CardBody className="space-y-2">
            {results.map((r) => (
              <details key={r.serverId} className="rounded-md border border-white/5 bg-white/[0.02] p-2">
                <summary className="flex cursor-pointer items-center gap-2 text-xs text-white">
                  <Badge tone={r.code === 0 ? 'green' : 'red'}>exit {r.code}</Badge>
                  <span className="font-medium">{r.serverName}</span>
                </summary>
                <pre className="mt-2 max-h-60 overflow-auto rounded bg-black/40 p-2 font-mono text-[10px] text-white/75">
                  {r.stdout || r.stderr || '(no output)'}
                </pre>
              </details>
            ))}
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}

function ModePill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md border px-3 py-1 text-[11px] transition-colors ${
        active ? 'border-neon-magenta/50 bg-neon-magenta/10 text-neon-magenta' : 'border-white/10 text-white/55 hover:border-white/25 hover:text-white'
      }`}
    >
      {children}
    </button>
  );
}
