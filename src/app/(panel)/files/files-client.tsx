'use client';

import * as React from 'react';
import {
  ChevronRight,
  Download,
  Edit3,
  File as FileIcon,
  FilePlus,
  Folder,
  FolderPlus,
  HardDrive,
  Home,
  MoreVertical,
  RefreshCw,
  Save,
  ShieldAlert,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input, Textarea } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/empty';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/components/ui/toaster';
import { formatBytes, formatRelative } from '@/lib/utils';
import { useServer, withServer } from '@/components/layout/server-context';

interface Item {
  name: string;
  path: string;
  type: 'directory' | 'file' | 'symlink';
  size: number;
  modifiedAt: string | null;
  isSensitive?: boolean;
  isRoot?: boolean;
}

interface ListResponse {
  cwd: string;
  parent?: string;
  root?: string;
  isVirtualRoot?: boolean;
  items: Item[];
  roots: string[];
  source?: 'host-ssh' | 'container';
}

function PathBreadcrumb({ path, onNavigate }: { path: string; onNavigate: (p: string) => void }) {
  if (!path) return <span className="text-white/40">Allowed roots</span>;
  const parts = path.split(/[\\/]/).filter(Boolean);
  const isWindows = /^[a-zA-Z]:/.test(path);
  const sep = isWindows ? '\\' : '/';
  const segs: { label: string; value: string }[] = [];
  let acc = isWindows ? '' : '/';
  for (const p of parts) {
    acc = acc === '/' ? `/${p}` : acc === '' ? p : `${acc}${sep}${p}`;
    segs.push({ label: p, value: acc });
  }
  return (
    <nav className="flex flex-wrap items-center gap-1 text-xs text-white/60">
      <button
        onClick={() => onNavigate('')}
        className="flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors hover:bg-white/5 hover:text-white"
      >
        <Home className="h-3 w-3" />
        roots
      </button>
      {segs.map((s) => (
        <React.Fragment key={s.value}>
          <ChevronRight className="h-3 w-3 text-white/30" />
          <button
            onClick={() => onNavigate(s.value)}
            className="rounded px-1.5 py-0.5 transition-colors hover:bg-white/5 hover:text-white"
          >
            {s.label}
          </button>
        </React.Fragment>
      ))}
    </nav>
  );
}

export function FilesClient() {
  const { toast } = useToast();
  const { current } = useServer();
  const serverId = current?.id ?? null;
  const [cwd, setCwd] = React.useState<string>('');
  const [data, setData] = React.useState<ListResponse | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [refreshKey, setRefreshKey] = React.useState(0);

  // Modals
  const [editing, setEditing] = React.useState<{ path: string; content: string; sensitive: boolean } | null>(null);
  const [createOpen, setCreateOpen] = React.useState<null | 'file' | 'folder'>(null);
  const [createName, setCreateName] = React.useState('');
  const [renameTarget, setRenameTarget] = React.useState<Item | null>(null);
  const [renameNew, setRenameNew] = React.useState('');
  const [deleteTarget, setDeleteTarget] = React.useState<Item | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await fetch(withServer(`/api/files/list?path=${encodeURIComponent(cwd)}`, serverId), { cache: 'no-store' });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `Failed (${res.status})`);
        }
        const json = (await res.json()) as ListResponse;
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cwd, refreshKey, serverId]);

  // When the active server changes, jump back to the virtual root so we don't
  // show stale paths from another machine.
  React.useEffect(() => {
    setCwd('');
  }, [serverId]);

  const refresh = () => setRefreshKey((k) => k + 1);

  async function openFile(it: Item) {
    if (it.type === 'directory') {
      setCwd(it.path);
      return;
    }
    try {
      const res = await fetch(withServer(`/api/files/read?path=${encodeURIComponent(it.path)}`, serverId), { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Failed');
      if (body.binary) {
        toast({ variant: 'info', title: 'Binary file', description: 'This file cannot be edited in the browser. Use Download.' });
        return;
      }
      if (body.truncated || body.content == null) {
        toast({ variant: 'info', title: 'File too large', description: body.error ?? 'File is too large to edit in the browser.' });
        return;
      }
      setEditing({ path: body.path, content: body.content, sensitive: !!body.sensitive });
    } catch (err) {
      toast({ variant: 'error', title: 'Could not open file', description: err instanceof Error ? err.message : String(err) });
    }
  }

  async function saveFile() {
    if (!editing) return;
    try {
      const res = await fetch(withServer('/api/files/write', serverId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: editing.path, content: editing.content }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Failed');
      toast({ variant: 'success', title: 'Saved' });
      setEditing(null);
      refresh();
    } catch (err) {
      toast({ variant: 'error', title: 'Save failed', description: err instanceof Error ? err.message : String(err) });
    }
  }

  async function createItem() {
    if (!createOpen || !createName.trim() || !data) return;
    const sep = /^[a-zA-Z]:/.test(cwd) ? '\\' : '/';
    const target = `${cwd.replace(/[\\/]$/, '')}${sep}${createName.trim()}`;
    try {
      const res = await fetch(withServer('/api/files/create', serverId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: target, type: createOpen }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Failed');
      toast({ variant: 'success', title: `${createOpen === 'folder' ? 'Folder' : 'File'} created` });
      setCreateOpen(null);
      setCreateName('');
      refresh();
    } catch (err) {
      toast({ variant: 'error', title: 'Create failed', description: err instanceof Error ? err.message : String(err) });
    }
  }

  async function renameItem() {
    if (!renameTarget || !renameNew.trim()) return;
    const sep = /^[a-zA-Z]:/.test(renameTarget.path) ? '\\' : '/';
    const parent = renameTarget.path.replace(/[\\/][^\\/]+$/, '');
    const target = `${parent}${sep}${renameNew.trim()}`;
    try {
      const res = await fetch(withServer('/api/files/rename', serverId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: renameTarget.path, to: target }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Failed');
      toast({ variant: 'success', title: 'Renamed' });
      setRenameTarget(null);
      setRenameNew('');
      refresh();
    } catch (err) {
      toast({ variant: 'error', title: 'Rename failed', description: err instanceof Error ? err.message : String(err) });
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    try {
      const res = await fetch(withServer('/api/files/delete', serverId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: deleteTarget.path }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Failed');
      toast({ variant: 'success', title: 'Deleted' });
      setDeleteTarget(null);
      refresh();
    } catch (err) {
      toast({ variant: 'error', title: 'Delete failed', description: err instanceof Error ? err.message : String(err) });
    }
  }

  async function handleUpload(ev: React.ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0];
    ev.target.value = '';
    if (!file || !cwd) return;
    try {
      const form = new FormData();
      form.append('path', cwd);
      form.append('file', file);
      const res = await fetch(withServer('/api/files/upload', serverId), { method: 'POST', body: form });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Failed');
      toast({ variant: 'success', title: 'Uploaded', description: file.name });
      refresh();
    } catch (err) {
      toast({ variant: 'error', title: 'Upload failed', description: err instanceof Error ? err.message : String(err) });
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-white">
            Files
            {data?.source === 'host-ssh' ? (
              <Badge tone="green">host</Badge>
            ) : data?.source === 'container' ? (
              <Badge tone="yellow">container</Badge>
            ) : null}
          </h1>
          <div className="mt-1"><PathBreadcrumb path={cwd} onNavigate={setCwd} /></div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={refresh}>
            <RefreshCw className="h-3 w-3" />
            Refresh
          </Button>
          {cwd ? (
            <>
              <Button variant="outline" size="sm" onClick={() => setCreateOpen('folder')}>
                <FolderPlus className="h-3 w-3" />
                New folder
              </Button>
              <Button variant="outline" size="sm" onClick={() => setCreateOpen('file')}>
                <FilePlus className="h-3 w-3" />
                New file
              </Button>
              <Button size="sm" onClick={() => fileInputRef.current?.click()}>
                <Upload className="h-3 w-3" />
                Upload
              </Button>
              <input ref={fileInputRef} type="file" hidden onChange={handleUpload} />
            </>
          ) : null}
        </div>
      </div>

      {data && data.isVirtualRoot ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {data.items.map((root) => (
            <button
              key={root.path}
              onClick={() => setCwd(root.path)}
              className="glass group flex items-center gap-3 p-4 text-left transition-all hover:border-neon-green/40 hover:shadow-neon-green"
            >
              <div className="rounded-lg border border-neon-green/30 bg-neon-green/10 p-2 text-neon-green">
                <HardDrive className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-white">{root.path}</div>
                <div className="text-[11px] text-white/40">allowed root</div>
              </div>
              <ChevronRight className="h-4 w-4 text-white/30 group-hover:text-neon-green" />
            </button>
          ))}
          {data.items.length === 0 ? (
            <EmptyState
              icon={<ShieldAlert className="h-8 w-8" />}
              title="No file roots configured"
              description="Set ALLOWED_FILE_ROOTS in your environment to enable the file manager."
              className="md:col-span-2 lg:col-span-3"
            />
          ) : null}
        </div>
      ) : (
        <Card className="p-0">
          {loading && !data ? (
            <div className="space-y-3 p-5">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : error ? (
            <EmptyState title="Could not list directory" description={error} />
          ) : data && data.items.length === 0 ? (
            <EmptyState title="Empty directory" description="Upload a file or create a folder to get started." />
          ) : (
            <div className="divide-y divide-white/[0.04]">
              <div className="grid grid-cols-[1fr_120px_180px_40px] gap-3 px-5 py-3 text-[10px] uppercase tracking-wider text-white/40">
                <div>Name</div>
                <div className="text-right">Size</div>
                <div>Modified</div>
                <div />
              </div>
              {data?.parent !== undefined ? (
                <button
                  onClick={() => setCwd(data.parent ?? '')}
                  className="grid w-full grid-cols-[1fr_120px_180px_40px] items-center gap-3 px-5 py-3 text-left text-sm text-white/70 transition-colors hover:bg-white/[0.03] hover:text-white"
                >
                  <div className="flex items-center gap-2">
                    <Folder className="h-4 w-4 text-white/40" />
                    <span>..</span>
                  </div>
                  <div />
                  <div className="text-white/40">parent directory</div>
                  <div />
                </button>
              ) : null}
              {data?.items.map((it) => (
                <div
                  key={it.path}
                  className="grid grid-cols-[1fr_120px_180px_40px] items-center gap-3 px-5 py-2.5 transition-colors hover:bg-white/[0.03]"
                >
                  <button
                    onClick={() => openFile(it)}
                    className="flex min-w-0 items-center gap-2 text-left text-sm text-white"
                  >
                    {it.type === 'directory' ? (
                      <Folder className="h-4 w-4 shrink-0 text-neon-green" />
                    ) : (
                      <FileIcon className="h-4 w-4 shrink-0 text-white/50" />
                    )}
                    <span className="truncate">{it.name}</span>
                    {it.isSensitive ? <Badge tone="yellow"><ShieldAlert className="h-3 w-3" /> sensitive</Badge> : null}
                  </button>
                  <div className="text-right text-xs text-white/60">{it.type === 'file' ? formatBytes(it.size) : ''}</div>
                  <div className="text-xs text-white/40">{formatRelative(it.modifiedAt)}</div>
                  <DropdownMenu>
                    <DropdownMenuTrigger className="rounded p-1 text-white/40 hover:bg-white/10 hover:text-white">
                      <MoreVertical className="h-4 w-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {it.type === 'file' ? (
                        <>
                          <DropdownMenuItem onClick={() => openFile(it)}>
                            <Edit3 className="h-4 w-4" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem asChild>
                            <a
                              href={withServer(`/api/files/download?path=${encodeURIComponent(it.path)}`, serverId)}
                              className="flex items-center gap-2"
                            >
                              <Download className="h-4 w-4" />
                              Download
                            </a>
                          </DropdownMenuItem>
                        </>
                      ) : null}
                      <DropdownMenuItem
                        onClick={() => {
                          setRenameTarget(it);
                          setRenameNew(it.name);
                        }}
                      >
                        <Edit3 className="h-4 w-4" />
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem danger onClick={() => setDeleteTarget(it)}>
                        <Trash2 className="h-4 w-4" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Editor */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Edit3 className="h-4 w-4 text-neon-green" />
              <span className="truncate">{editing?.path}</span>
              {editing?.sensitive ? <Badge tone="yellow">sensitive</Badge> : null}
            </DialogTitle>
            <DialogDescription>Text mode editor — saved as UTF-8.</DialogDescription>
          </DialogHeader>
          <Textarea
            value={editing?.content ?? ''}
            onChange={(e) => setEditing((prev) => (prev ? { ...prev, content: e.target.value } : prev))}
            className="h-[55vh] resize-none"
            spellCheck={false}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              <X className="h-4 w-4" />
              Cancel
            </Button>
            <Button onClick={saveFile}>
              <Save className="h-4 w-4" />
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create */}
      <Dialog open={!!createOpen} onOpenChange={(o) => !o && (setCreateOpen(null), setCreateName(''))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{createOpen === 'folder' ? 'New folder' : 'New file'}</DialogTitle>
            <DialogDescription>Will be created inside {cwd}</DialogDescription>
          </DialogHeader>
          <Input
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            placeholder={createOpen === 'folder' ? 'my-folder' : 'notes.txt'}
            autoFocus
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setCreateOpen(null); setCreateName(''); }}>Cancel</Button>
            <Button onClick={createItem} disabled={!createName.trim()}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename */}
      <Dialog open={!!renameTarget} onOpenChange={(o) => !o && setRenameTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename</DialogTitle>
            <DialogDescription className="truncate">{renameTarget?.path}</DialogDescription>
          </DialogHeader>
          <Input value={renameNew} onChange={(e) => setRenameNew(e.target.value)} autoFocus />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenameTarget(null)}>Cancel</Button>
            <Button onClick={renameItem} disabled={!renameNew.trim()}>Rename</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash2 className="h-4 w-4 text-red-400" />
              Delete {deleteTarget?.type === 'directory' ? 'folder' : 'file'}?
            </DialogTitle>
            <DialogDescription className="truncate">{deleteTarget?.path}</DialogDescription>
          </DialogHeader>
          {deleteTarget?.type === 'directory' ? (
            <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
              The folder and all of its contents will be permanently removed.
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="danger" onClick={confirmDelete}>
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
