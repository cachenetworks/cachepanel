'use client';

import * as React from 'react';
import {
  AlertTriangle,
  ChevronRight,
  Database,
  Loader2,
  Pencil,
  Play,
  Plug,
  Plus,
  RefreshCw,
  Save,
  Server,
  Table as TableIcon,
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
import { cn } from '@/lib/utils';

type Driver = 'mysql' | 'mariadb' | 'postgres' | 'sqlite';

interface ConnRow {
  id: string;
  name: string;
  driver: Driver;
  host: string | null;
  port: number | null;
  username: string | null;
  database: string | null;
  ssl: boolean;
  ownerOnly: boolean;
  readOnly: boolean;
  notes: string | null;
}

interface QueryResult {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  truncated: boolean;
  affected?: number;
  durationMs: number;
}

interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  primaryKey: boolean;
  defaultValue: string | null;
}

interface TableInfo {
  schema?: string | null;
  name: string;
  rowEstimate?: number | null;
}

const DRIVER_DEFAULTS: Record<Driver, { port: number | null; user: string; database: string }> = {
  mysql: { port: 3306, user: 'root', database: '' },
  mariadb: { port: 3306, user: 'root', database: '' },
  postgres: { port: 5432, user: 'postgres', database: '' },
  sqlite: { port: null, user: '', database: '/path/to/file.db' },
};

const driverTone: Record<Driver, 'green' | 'magenta' | 'blue' | 'yellow'> = {
  mysql: 'blue',
  mariadb: 'blue',
  postgres: 'green',
  sqlite: 'magenta',
};

export function DatabasesClient({ role }: { role: 'OWNER' | 'ADMIN' }) {
  const { toast } = useToast();
  const [conns, setConns] = React.useState<ConnRow[] | null>(null);
  const [active, setActive] = React.useState<ConnRow | null>(null);
  const [databases, setDatabases] = React.useState<string[]>([]);
  const [activeDb, setActiveDb] = React.useState<string>('');
  const [tables, setTables] = React.useState<TableInfo[] | null>(null);
  const [activeTable, setActiveTable] = React.useState<TableInfo | null>(null);
  const [columns, setColumns] = React.useState<ColumnInfo[] | null>(null);
  const [previewRows, setPreviewRows] = React.useState<QueryResult | null>(null);
  const [sql, setSql] = React.useState<string>('');
  const [running, setRunning] = React.useState(false);
  const [queryResult, setQueryResult] = React.useState<QueryResult | null>(null);
  const [queryError, setQueryError] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<ConnRow | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [deleteConn, setDeleteConn] = React.useState<ConnRow | null>(null);

  const isOwner = role === 'OWNER';

  const load = React.useCallback(async () => {
    try {
      const r = await fetch('/api/db', { cache: 'no-store' });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? `Failed (${r.status})`);
      setConns(body.connections);
    } catch (err) {
      toast({ variant: 'error', title: 'Load failed', description: err instanceof Error ? err.message : String(err) });
    }
  }, [toast]);

  React.useEffect(() => {
    load();
  }, [load]);

  async function selectConnection(c: ConnRow) {
    setActive(c);
    setDatabases([]);
    setActiveDb('');
    setTables(null);
    setActiveTable(null);
    setColumns(null);
    setPreviewRows(null);
    setQueryResult(null);
    setQueryError(null);
    setSql('SELECT 1;');
    try {
      if (c.driver !== 'sqlite') {
        const r = await fetch(`/api/db/${c.id}/databases`, { cache: 'no-store' });
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? `Failed (${r.status})`);
        setDatabases(body.databases);
        const initial = c.database || body.databases[0] || '';
        setActiveDb(initial);
        await loadTables(c, initial);
      } else {
        await loadTables(c, '');
      }
    } catch (err) {
      toast({ variant: 'error', title: 'Connect failed', description: err instanceof Error ? err.message : String(err) });
    }
  }

  async function loadTables(c: ConnRow, db: string) {
    setTables(null);
    try {
      const url = db ? `/api/db/${c.id}/tables?database=${encodeURIComponent(db)}` : `/api/db/${c.id}/tables`;
      const r = await fetch(url, { cache: 'no-store' });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? `Failed (${r.status})`);
      setTables(body.tables);
    } catch (err) {
      toast({ variant: 'error', title: 'Tables failed', description: err instanceof Error ? err.message : String(err) });
      setTables([]);
    }
  }

  async function selectTable(t: TableInfo) {
    if (!active) return;
    setActiveTable(t);
    setColumns(null);
    setPreviewRows(null);
    try {
      const params = new URLSearchParams({ table: t.name });
      if (t.schema) params.set('schema', t.schema);
      const [descRes, rowsRes] = await Promise.all([
        fetch(`/api/db/${active.id}/describe?${params}`, { cache: 'no-store' }),
        fetch(`/api/db/${active.id}/query`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sql: previewSql(active.driver, t),
            database: activeDb || undefined,
          }),
        }),
      ]);
      const desc = await descRes.json();
      const rows = await rowsRes.json();
      if (!descRes.ok) throw new Error(desc.error ?? 'describe failed');
      setColumns(desc.columns);
      if (rowsRes.ok) setPreviewRows(rows);
    } catch (err) {
      toast({ variant: 'error', title: 'Table inspect failed', description: err instanceof Error ? err.message : String(err) });
    }
  }

  async function executeQuery() {
    if (!active || !sql.trim() || running) return;
    setRunning(true);
    setQueryError(null);
    setQueryResult(null);
    try {
      const r = await fetch(`/api/db/${active.id}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql, database: activeDb || undefined }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? `Failed (${r.status})`);
      setQueryResult(body);
    } catch (err) {
      setQueryError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  async function testProfile(c: ConnRow) {
    try {
      const r = await fetch(`/api/db/${c.id}/test`, { method: 'POST' });
      const body = await r.json();
      if (body.ok) {
        toast({ variant: 'success', title: 'Connection OK', description: `${body.durationMs}ms` });
      } else {
        toast({ variant: 'error', title: 'Connection failed', description: body.error });
      }
    } catch (err) {
      toast({ variant: 'error', title: 'Test failed', description: err instanceof Error ? err.message : String(err) });
    }
  }

  async function deleteProfile() {
    if (!deleteConn) return;
    try {
      const r = await fetch(`/api/db/${deleteConn.id}`, { method: 'DELETE' });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error ?? `Failed (${r.status})`);
      toast({ variant: 'success', title: 'Connection deleted' });
      if (active?.id === deleteConn.id) setActive(null);
      setDeleteConn(null);
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
            <Database className="h-5 w-5 text-neon-green" />
            Databases
          </h1>
          <p className="text-xs text-white/50">
            MySQL · MariaDB · Postgres · SQLite — connect, browse, run SQL.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={load}>
            <RefreshCw className="h-3 w-3" />
            Refresh
          </Button>
          {isOwner ? (
            <Button size="sm" onClick={() => { setCreating(true); setEditing(null); }}>
              <Plus className="h-3 w-3" />
              New connection
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_1fr]">
        {/* Left: profile list */}
        <Card className="p-0">
          <div className="border-b border-white/5 px-4 py-2 text-[10px] uppercase tracking-wider text-white/40">
            Profiles
          </div>
          {conns === null ? (
            <div className="space-y-2 p-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : conns.length === 0 ? (
            <EmptyState
              icon={<Plug className="h-6 w-6" />}
              title="No connections"
              description={isOwner ? 'Add your first connection profile.' : 'OWNER hasn\'t added any.'}
            />
          ) : (
            <ul className="divide-y divide-white/[0.04]">
              {conns.map((c) => (
                <li
                  key={c.id}
                  className={cn(
                    'group flex cursor-pointer items-center gap-2 px-3 py-2 transition-colors hover:bg-white/[0.03]',
                    active?.id === c.id ? 'bg-white/[0.04]' : '',
                  )}
                  onClick={() => selectConnection(c)}
                >
                  <Badge tone={driverTone[c.driver]}>{c.driver}</Badge>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-white">{c.name}</div>
                    <div className="truncate text-[10px] text-white/40">
                      {c.driver === 'sqlite'
                        ? c.database
                        : `${c.host || '—'}:${c.port ?? '?'}${c.database ? '/' + c.database : ''}`}
                    </div>
                  </div>
                  {c.readOnly ? <Badge tone="yellow">RO</Badge> : null}
                  {c.ownerOnly ? <Badge tone="magenta">OWN</Badge> : null}
                  <ChevronRight className="h-3 w-3 text-white/30 group-hover:text-white/60" />
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Right: workspace */}
        {!active ? (
          <EmptyState
            icon={<Database className="h-8 w-8" />}
            title="Select a connection"
            description="Pick a profile on the left, or add one if you're OWNER."
          />
        ) : (
          <div className="flex flex-col gap-4">
            {/* Header */}
            <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Server className="h-4 w-4 text-neon-green" />
                  <span className="text-sm font-semibold text-white">{active.name}</span>
                  <Badge tone={driverTone[active.driver]}>{active.driver}</Badge>
                  {active.readOnly ? <Badge tone="yellow">read-only</Badge> : null}
                </div>
                <div className="mt-1 truncate text-[11px] text-white/40">
                  {active.driver === 'sqlite' ? active.database : `${active.username ?? ''}@${active.host}:${active.port}`}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {databases.length > 0 ? (
                  <select
                    value={activeDb}
                    onChange={(e) => {
                      setActiveDb(e.target.value);
                      loadTables(active, e.target.value);
                      setActiveTable(null);
                      setColumns(null);
                      setPreviewRows(null);
                    }}
                    className="h-9 rounded-lg border border-white/10 bg-black/40 px-3 text-sm text-white outline-none focus:border-neon-green/40"
                  >
                    {databases.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                ) : null}
                <Button variant="outline" size="sm" onClick={() => testProfile(active)}>
                  <Plug className="h-3 w-3" />
                  Test
                </Button>
                {isOwner ? (
                  <>
                    <Button variant="ghost" size="sm" onClick={() => { setEditing(active); setCreating(false); }}>
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setDeleteConn(active)}>
                      <Trash2 className="h-3 w-3 text-red-400" />
                    </Button>
                  </>
                ) : null}
              </div>
            </Card>

            {/* Browser + runner */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_1fr]">
              <Card className="p-0">
                <div className="border-b border-white/5 px-3 py-2 text-[10px] uppercase tracking-wider text-white/40">
                  Tables
                </div>
                {tables === null ? (
                  <div className="space-y-1 p-3">
                    {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-7 w-full" />)}
                  </div>
                ) : tables.length === 0 ? (
                  <EmptyState title="No tables" />
                ) : (
                  <ul className="max-h-[55vh] overflow-y-auto divide-y divide-white/[0.04]">
                    {tables.map((t) => (
                      <li
                        key={(t.schema ?? '') + t.name}
                        onClick={() => selectTable(t)}
                        className={cn(
                          'flex cursor-pointer items-center gap-2 px-3 py-2 hover:bg-white/[0.03]',
                          activeTable?.name === t.name && activeTable?.schema === t.schema ? 'bg-white/[0.04]' : '',
                        )}
                      >
                        <TableIcon className="h-3 w-3 text-white/40" />
                        <span className="flex-1 truncate text-sm text-white">
                          {t.schema ? <span className="text-white/40">{t.schema}.</span> : null}
                          {t.name}
                        </span>
                        {typeof t.rowEstimate === 'number' ? (
                          <span className="text-[10px] text-white/40">{t.rowEstimate.toLocaleString()}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              <div className="flex flex-col gap-4">
                {/* SQL runner */}
                <Card className="p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-[10px] uppercase tracking-wider text-white/40">SQL runner</div>
                    <div className="flex items-center gap-2">
                      {queryResult ? (
                        <span className="text-[11px] text-white/50">
                          {queryResult.rowCount.toLocaleString()} rows · {queryResult.durationMs}ms
                          {queryResult.truncated ? ' · truncated to 5000' : ''}
                          {typeof queryResult.affected === 'number' && queryResult.columns.length === 0
                            ? ` · affected ${queryResult.affected}`
                            : ''}
                        </span>
                      ) : null}
                      <Button onClick={executeQuery} disabled={running || !sql.trim()}>
                        {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                        Run (Ctrl+Enter)
                      </Button>
                    </div>
                  </div>
                  <Textarea
                    value={sql}
                    onChange={(e) => setSql(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                        e.preventDefault();
                        executeQuery();
                      }
                    }}
                    spellCheck={false}
                    className="h-32 resize-y"
                    placeholder="SELECT * FROM users LIMIT 50;"
                  />
                </Card>

                {/* Result */}
                {queryError ? (
                  <Card>
                    <div className="flex items-start gap-2 text-sm text-red-300">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs">
                        {queryError}
                      </pre>
                    </div>
                  </Card>
                ) : null}

                {queryResult && queryResult.columns.length > 0 ? (
                  <ResultTable result={queryResult} />
                ) : queryResult && queryResult.columns.length === 0 ? (
                  <Card>
                    <div className="text-sm text-neon-green">
                      Query OK — affected {queryResult.affected ?? 0} row(s) in {queryResult.durationMs}ms.
                    </div>
                  </Card>
                ) : null}

                {/* Table preview */}
                {activeTable ? (
                  <Card className="p-0">
                    <div className="flex items-center justify-between border-b border-white/5 px-4 py-2">
                      <div>
                        <div className="text-sm text-white">
                          {activeTable.schema ? <span className="text-white/40">{activeTable.schema}.</span> : null}
                          {activeTable.name}
                          <span className="ml-2 text-[10px] text-white/40">{columns?.length ?? 0} columns</span>
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-2">
                      <div className="border-r border-white/5 p-3">
                        <div className="mb-1 text-[10px] uppercase tracking-wider text-white/40">Schema</div>
                        {!columns ? (
                          <Skeleton className="h-32 w-full" />
                        ) : (
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-left text-[10px] uppercase tracking-wider text-white/40">
                                <th className="px-1 py-1">name</th>
                                <th className="px-1 py-1">type</th>
                                <th className="px-1 py-1">null</th>
                                <th className="px-1 py-1">pk</th>
                              </tr>
                            </thead>
                            <tbody>
                              {columns.map((col) => (
                                <tr key={col.name} className="border-t border-white/5">
                                  <td className="px-1 py-0.5 text-white">{col.name}</td>
                                  <td className="px-1 py-0.5 font-mono text-[10px] text-white/70">{col.type}</td>
                                  <td className="px-1 py-0.5 text-white/50">{col.nullable ? 'Y' : ''}</td>
                                  <td className="px-1 py-0.5 text-neon-green">{col.primaryKey ? 'PK' : ''}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                      <div className="p-3">
                        <div className="mb-1 text-[10px] uppercase tracking-wider text-white/40">Preview</div>
                        {previewRows ? (
                          <ResultTable result={previewRows} compact />
                        ) : (
                          <Skeleton className="h-32 w-full" />
                        )}
                      </div>
                    </div>
                  </Card>
                ) : null}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Create / edit dialog */}
      <ProfileDialog
        open={creating || !!editing}
        onClose={() => { setCreating(false); setEditing(null); }}
        existing={editing}
        afterSave={() => { setCreating(false); setEditing(null); load(); }}
      />

      {/* Delete confirm */}
      <Dialog open={!!deleteConn} onOpenChange={(o) => !o && setDeleteConn(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash2 className="h-4 w-4 text-red-400" />
              Delete connection?
            </DialogTitle>
            <DialogDescription>
              The remote database is untouched — only the saved profile is removed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteConn(null)}>Cancel</Button>
            <Button variant="danger" onClick={deleteProfile}>
              <Trash2 className="h-4 w-4" /> Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function previewSql(driver: Driver, t: TableInfo): string {
  const ident = driver === 'mysql' || driver === 'mariadb'
    ? `\`${t.name.replace(/`/g, '')}\``
    : driver === 'postgres'
      ? `${t.schema ? `"${t.schema}".` : ''}"${t.name.replace(/"/g, '')}"`
      : `"${t.name.replace(/"/g, '')}"`;
  return `SELECT * FROM ${ident} LIMIT 50;`;
}

function ResultTable({ result, compact }: { result: QueryResult; compact?: boolean }) {
  if (result.rows.length === 0) {
    return (
      <Card>
        <div className="text-xs text-white/50">Empty result.</div>
      </Card>
    );
  }
  return (
    <Card className="overflow-x-auto p-0">
      <table className={cn('w-full text-xs', compact ? '' : '')}>
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wider text-white/40">
            {result.columns.map((c) => (
              <th key={c} className="border-b border-white/10 px-3 py-2">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row, i) => (
            <tr key={i} className="border-b border-white/[0.04] hover:bg-white/[0.02]">
              {row.map((cell, j) => (
                <td key={j} className="max-w-[400px] truncate px-3 py-1.5 font-mono text-[11px] text-white/80" title={String(cell ?? '')}>
                  {cell == null ? <span className="text-white/30">null</span> : String(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function ProfileDialog({
  open,
  onClose,
  existing,
  afterSave,
}: {
  open: boolean;
  onClose: () => void;
  existing: ConnRow | null;
  afterSave: () => void;
}) {
  const { toast } = useToast();
  const [draft, setDraft] = React.useState<{
    name: string;
    driver: Driver;
    host: string;
    port: number | null;
    username: string;
    password: string;
    database: string;
    ssl: boolean;
    ownerOnly: boolean;
    readOnly: boolean;
    notes: string;
  } | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    if (existing) {
      setDraft({
        name: existing.name,
        driver: existing.driver,
        host: existing.host ?? '',
        port: existing.port,
        username: existing.username ?? '',
        password: '',
        database: existing.database ?? '',
        ssl: existing.ssl,
        ownerOnly: existing.ownerOnly,
        readOnly: existing.readOnly,
        notes: existing.notes ?? '',
      });
    } else {
      setDraft({
        name: '',
        driver: 'mysql',
        host: '127.0.0.1',
        port: 3306,
        username: 'root',
        password: '',
        database: '',
        ssl: false,
        ownerOnly: false,
        readOnly: false,
        notes: '',
      });
    }
  }, [open, existing]);

  if (!draft) return null;

  function changeDriver(driver: Driver) {
    const d = DRIVER_DEFAULTS[driver];
    setDraft((cur) => (cur ? { ...cur, driver, port: d.port, username: d.user, database: d.database } : cur));
  }

  async function save() {
    if (!draft) return;
    setBusy(true);
    try {
      const url = existing ? `/api/db/${existing.id}` : '/api/db';
      const method = existing ? 'PUT' : 'POST';
      const r = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: draft.name,
          driver: draft.driver,
          host: draft.host,
          port: draft.port ?? undefined,
          username: draft.username,
          password: draft.password || undefined, // empty = keep existing
          database: draft.database,
          ssl: draft.ssl,
          ownerOnly: draft.ownerOnly,
          readOnly: draft.readOnly,
          notes: draft.notes,
        }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error ?? `Failed (${r.status})`);
      toast({ variant: 'success', title: existing ? 'Updated' : 'Created' });
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
          <DialogTitle>{existing ? 'Edit connection' : 'New connection'}</DialogTitle>
          <DialogDescription>
            Passwords are encrypted at rest with the panel&apos;s NEXTAUTH_SECRET.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name" full>
            <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </Field>
          <Field label="Driver">
            <select
              value={draft.driver}
              onChange={(e) => changeDriver(e.target.value as Driver)}
              className="flex h-10 w-full rounded-lg border border-white/10 bg-black/40 px-3 text-sm text-white outline-none focus:border-neon-green/40"
            >
              <option value="mysql">MySQL</option>
              <option value="mariadb">MariaDB</option>
              <option value="postgres">Postgres</option>
              <option value="sqlite">SQLite</option>
            </select>
          </Field>
          {draft.driver !== 'sqlite' ? (
            <>
              <Field label="Host">
                <Input value={draft.host} onChange={(e) => setDraft({ ...draft, host: e.target.value })} />
              </Field>
              <Field label="Port">
                <Input
                  type="number"
                  value={draft.port ?? ''}
                  onChange={(e) => setDraft({ ...draft, port: e.target.value ? parseInt(e.target.value, 10) : null })}
                />
              </Field>
              <Field label="Username">
                <Input value={draft.username} onChange={(e) => setDraft({ ...draft, username: e.target.value })} />
              </Field>
              <Field label={existing ? 'Password (leave blank to keep)' : 'Password'}>
                <Input
                  type="password"
                  value={draft.password}
                  onChange={(e) => setDraft({ ...draft, password: e.target.value })}
                  placeholder={existing ? '••••••••' : ''}
                />
              </Field>
              <Field label="Database (optional)" full>
                <Input value={draft.database} onChange={(e) => setDraft({ ...draft, database: e.target.value })} />
              </Field>
            </>
          ) : (
            <Field label="SQLite file path (absolute, on the host)" full>
              <Input
                value={draft.database}
                onChange={(e) => setDraft({ ...draft, database: e.target.value })}
                placeholder="/var/lib/myapp/data.db"
                className="font-mono"
              />
            </Field>
          )}
          <Field label="Notes" full>
            <Textarea
              rows={2}
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              className="min-h-[60px]"
            />
          </Field>
        </div>
        <div className="flex flex-wrap gap-3 text-xs">
          <Toggle
            label="SSL"
            checked={draft.ssl}
            onChange={(v) => setDraft({ ...draft, ssl: v })}
            disabled={draft.driver === 'sqlite'}
          />
          <Toggle
            label="Read-only (block all writes)"
            checked={draft.readOnly}
            onChange={(v) => setDraft({ ...draft, readOnly: v })}
          />
          <Toggle
            label="OWNER-only profile"
            checked={draft.ownerOnly}
            onChange={(v) => setDraft({ ...draft, ownerOnly: v })}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={busy || !draft.name.trim()}>
            <Save className="h-4 w-4" />
            {busy ? 'Saving…' : existing ? 'Save changes' : 'Create'}
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

function Toggle({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className={cn('flex items-center gap-2 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2 text-white/80', disabled && 'opacity-50')}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-neon-green"
      />
      {label}
    </label>
  );
}
