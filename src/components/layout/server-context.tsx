'use client';

import * as React from 'react';

export interface PanelServer {
  id: string;
  name: string;
  hostname: string;
  isPrimary: boolean;
  tags: string;
}

interface Ctx {
  servers: PanelServer[];
  current: PanelServer | null;
  setCurrent: (s: PanelServer) => void;
  refresh: () => Promise<void>;
}

const ServerCtx = React.createContext<Ctx | null>(null);

export function useServer() {
  const v = React.useContext(ServerCtx);
  if (!v) throw new Error('useServer must be used inside <ServerProvider>');
  return v;
}

const STORAGE_KEY = 'cp:current-server';

export function ServerProvider({ children }: { children: React.ReactNode }) {
  const [servers, setServers] = React.useState<PanelServer[]>([]);
  const [currentId, setCurrentId] = React.useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(STORAGE_KEY);
  });

  const refresh = React.useCallback(async () => {
    try {
      const r = await fetch('/api/servers', { cache: 'no-store' });
      const body = await r.json();
      if (r.ok && Array.isArray(body.servers)) {
        setServers(body.servers);
      }
    } catch {
      // ignore — picker just won't populate
    }
  }, []);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  // Auto-pick primary if no selection or selection is missing.
  React.useEffect(() => {
    if (servers.length === 0) return;
    const exists = currentId && servers.some((s) => s.id === currentId);
    if (!exists) {
      const primary = servers.find((s) => s.isPrimary) ?? servers[0]!;
      setCurrentId(primary.id);
      try {
        window.localStorage.setItem(STORAGE_KEY, primary.id);
      } catch {
        /* ignore */
      }
    }
  }, [servers, currentId]);

  const setCurrent = React.useCallback((s: PanelServer) => {
    setCurrentId(s.id);
    try {
      window.localStorage.setItem(STORAGE_KEY, s.id);
    } catch {
      /* ignore */
    }
    // Notify any listeners (e.g. data-fetching pages can re-fetch).
    try {
      window.dispatchEvent(new CustomEvent('cp:server-changed', { detail: s.id }));
    } catch {
      /* ignore */
    }
  }, []);

  const current = React.useMemo(
    () => servers.find((s) => s.id === currentId) ?? servers.find((s) => s.isPrimary) ?? servers[0] ?? null,
    [servers, currentId],
  );

  return (
    <ServerCtx.Provider value={{ servers, current, setCurrent, refresh }}>{children}</ServerCtx.Provider>
  );
}

// Returns the current server's ID — useful for fetch URLs.
export function useCurrentServerId(): string | null {
  const { current } = useServer();
  return current?.id ?? null;
}

// Wrapper that adds ?server=<id> to a relative URL.
export function withServer(url: string, serverId: string | null): string {
  if (!serverId) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}server=${encodeURIComponent(serverId)}`;
}
