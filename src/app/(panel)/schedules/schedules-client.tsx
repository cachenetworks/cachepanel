'use client';

import * as React from 'react';
import { Calendar, Loader2, Plus, Trash2 } from 'lucide-react';
import { Card, CardBody, CardHeader, CardSubtitle, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toaster';
import type { PanelUser } from '@/lib/session';

interface Job {
  id: string;
  name: string;
  cronExpr: string;
  command: string;
  enabled: boolean;
  server: { id: string; name: string };
  lastRanAt: string | null;
  lastExitCode: number | null;
}

interface ServerLite {
  id: string;
  name: string;
  isPrimary: boolean;
}

const PRESETS = [
  { label: 'Every minute', expr: '* * * * *' },
  { label: 'Every 5 min', expr: '*/5 * * * *' },
  { label: 'Every hour', expr: '0 * * * *' },
  { label: 'Daily 03:00', expr: '0 3 * * *' },
  { label: 'Weekly (Sun 03:00)', expr: '0 3 * * 0' },
  { label: 'Monthly (1st 03:00)', expr: '0 3 1 * *' },
];

export function SchedulesClient({ user }: { user: PanelUser }) {
  const { toast } = useToast();
  const [jobs, setJobs] = React.useState<Job[] | null>(null);
  const [servers, setServers] = React.useState<ServerLite[] | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [formServer, setFormServer] = React.useState('');
  const [formName, setFormName] = React.useState('');
  const [formCron, setFormCron] = React.useState('0 3 * * *');
  const [formCmd, setFormCmd] = React.useState('');

  const canManage = user.role === 'OWNER' || user.role === 'ADMIN';

  const load = React.useCallback(async () => {
    try {
      const [j, s] = await Promise.all([
        fetch('/api/schedules', { cache: 'no-store' }),
        fetch('/api/servers', { cache: 'no-store' }),
      ]);
      if (!j.ok || !s.ok) throw new Error('load failed');
      const jb = await j.json();
      const sb = await s.json();
      setJobs(jb.jobs);
      setServers(sb.servers);
      if (!formServer && sb.servers.length > 0) setFormServer(sb.servers[0].id);
    } catch (err) {
      toast({ variant: 'error', title: 'Load failed', description: err instanceof Error ? err.message : String(err) });
    }
  }, [toast, formServer]);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    if (!formServer || !formName || !formCron || !formCmd) {
      toast({ variant: 'error', title: 'All fields required' });
      return;
    }
    setCreating(true);
    try {
      const res = await fetch('/api/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serverId: formServer,
          name: formName,
          cronExpr: formCron,
          command: formCmd,
          enabled: true,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Failed');
      toast({ variant: 'success', title: 'Schedule added' });
      setFormName('');
      setFormCmd('');
      void load();
    } catch (err) {
      toast({ variant: 'error', title: 'Create failed', description: err instanceof Error ? err.message : String(err) });
    } finally {
      setCreating(false);
    }
  }

  async function remove(j: Job) {
    if (!confirm(`Delete "${j.name}"? The crontab line on ${j.server.name} will be removed too.`)) return;
    try {
      const res = await fetch(`/api/schedules/${j.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed');
      toast({ variant: 'success', title: 'Deleted' });
      void load();
    } catch (err) {
      toast({ variant: 'error', title: 'Delete failed', description: err instanceof Error ? err.message : String(err) });
    }
  }

  async function toggle(j: Job) {
    try {
      const res = await fetch(`/api/schedules/${j.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !j.enabled }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed');
      void load();
    } catch (err) {
      toast({ variant: 'error', title: 'Toggle failed', description: err instanceof Error ? err.message : String(err) });
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-white">
          <Calendar className="h-5 w-5 text-neon-magenta" />
          Scheduled commands
        </h1>
        <p className="text-xs text-white/50">
          Cron jobs CachePanel writes into the SSH user's crontab on a target server. Each entry is
          tagged so the panel only touches its own lines.
        </p>
      </div>

      {canManage ? (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>New schedule</CardTitle>
              <CardSubtitle>5-field crontab syntax</CardSubtitle>
            </div>
          </CardHeader>
          <CardBody className="space-y-2">
            <div className="grid gap-2 sm:grid-cols-2">
              <select
                value={formServer}
                onChange={(e) => setFormServer(e.target.value)}
                className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white focus:border-neon-magenta/50 focus:outline-none"
              >
                {servers?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}{s.isPrimary ? ' (primary)' : ''}
                  </option>
                ))}
              </select>
              <input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="Nightly backup"
                className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-neon-magenta/50 focus:outline-none"
              />
            </div>
            <div className="flex flex-wrap gap-1">
              {PRESETS.map((p) => (
                <button
                  key={p.expr}
                  onClick={() => setFormCron(p.expr)}
                  className={`rounded-md border px-2 py-0.5 text-[10px] uppercase tracking-wider transition-colors ${
                    formCron === p.expr
                      ? 'border-neon-magenta/50 bg-neon-magenta/10 text-neon-magenta'
                      : 'border-white/10 text-white/55 hover:border-white/25 hover:text-white'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <input
              value={formCron}
              onChange={(e) => setFormCron(e.target.value)}
              placeholder="0 3 * * *"
              className="w-full rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 font-mono text-xs text-white placeholder:text-white/30 focus:border-neon-magenta/50 focus:outline-none"
            />
            <input
              value={formCmd}
              onChange={(e) => setFormCmd(e.target.value)}
              placeholder="bash -c 'cd /srv/app && docker compose pull && docker compose up -d'"
              className="w-full rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 font-mono text-xs text-white placeholder:text-white/30 focus:border-neon-magenta/50 focus:outline-none"
            />
            <div className="flex justify-end">
              <Button onClick={create} disabled={creating}>
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                {creating ? 'Adding…' : 'Add schedule'}
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Schedules</CardTitle>
            <CardSubtitle>{jobs ? `${jobs.length} total` : 'loading…'}</CardSubtitle>
          </div>
        </CardHeader>
        <CardBody>
          {jobs === null ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : jobs.length === 0 ? (
            <p className="rounded-md border border-white/10 bg-white/[0.02] p-3 text-xs text-white/55">
              No schedules yet.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {jobs.map((j) => (
                <li key={j.id} className="flex items-center gap-3 rounded-md border border-white/5 bg-white/[0.02] p-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-xs font-medium text-white">
                      {j.name}
                      <Badge tone={j.enabled ? 'green' : 'magenta'}>{j.enabled ? 'on' : 'off'}</Badge>
                      <span className="text-[10px] font-normal text-white/40">@{j.server.name}</span>
                    </div>
                    <code className="block font-mono text-[10px] text-white/55">{j.cronExpr} · {j.command.slice(0, 80)}{j.command.length > 80 ? '…' : ''}</code>
                  </div>
                  {canManage ? (
                    <>
                      <Button variant="outline" onClick={() => toggle(j)}>
                        {j.enabled ? 'Disable' : 'Enable'}
                      </Button>
                      <Button variant="danger" onClick={() => remove(j)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
