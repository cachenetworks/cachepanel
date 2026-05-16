'use client';

import * as React from 'react';
import Script from 'next/script';
import { Download, Film, Play, Trash2 } from 'lucide-react';
import { Card, CardBody, CardHeader, CardSubtitle, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toaster';
import type { PanelUser } from '@/lib/session';

interface Recording {
  filename: string;
  size: number;
  createdAt: string;
}

// asciinema-player ships as both an npm package and standalone CDN bundles.
// We load the CDN build via next/script so we don't add ~150KB to the panel
// bundle for a feature most users will hit rarely.
const ASCIINEMA_JS = 'https://cdn.jsdelivr.net/npm/asciinema-player@3.7.1/dist/bundle/asciinema-player.min.js';
const ASCIINEMA_CSS = 'https://cdn.jsdelivr.net/npm/asciinema-player@3.7.1/dist/bundle/asciinema-player.min.css';

declare global {
  interface Window {
    AsciinemaPlayer?: {
      create: (
        src: string,
        target: HTMLElement,
        opts?: Record<string, unknown>,
      ) => { dispose: () => void };
    };
  }
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function RecordingsClient({ user }: { user: PanelUser }) {
  const { toast } = useToast();
  const [recordings, setRecordings] = React.useState<Recording[] | null>(null);
  const [playing, setPlaying] = React.useState<Recording | null>(null);
  const isOwner = user.role === 'OWNER';

  const load = React.useCallback(async () => {
    try {
      const res = await fetch('/api/recordings', { cache: 'no-store' });
      if (!res.ok) throw new Error(await res.text());
      const body = await res.json();
      setRecordings(body.recordings ?? []);
    } catch (err) {
      toast({ variant: 'error', title: 'Load failed', description: err instanceof Error ? err.message : String(err) });
    }
  }, [toast]);

  React.useEffect(() => {
    void load();
  }, [load]);

  if (!isOwner) {
    return (
      <Card>
        <CardBody>
          <p className="text-sm text-white/55">Terminal session recordings are OWNER-only.</p>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <Script src={ASCIINEMA_JS} strategy="lazyOnload" />
      <link rel="stylesheet" href={ASCIINEMA_CSS} />

      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-white">
          <Film className="h-5 w-5 text-neon-magenta" />
          Terminal session recordings
        </h1>
        <p className="text-xs text-white/50">
          Every browser-terminal session is recorded to <code>/app/data/recordings/</code> as
          asciinema v2 cast files. Replay in-browser, or download and play locally with{' '}
          <code>asciinema play</code>.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>{recordings ? `${recordings.length} session${recordings.length === 1 ? '' : 's'}` : 'Loading…'}</CardTitle>
            <CardSubtitle>most recent first</CardSubtitle>
          </div>
        </CardHeader>
        <CardBody>
          {recordings === null ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : recordings.length === 0 ? (
            <p className="rounded-md border border-white/10 bg-white/[0.02] p-3 text-xs text-white/55">
              No recordings yet. Open the browser terminal and run a command to generate one.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {recordings.map((r) => (
                <li key={r.filename} className="flex items-center gap-3 rounded-md border border-white/5 bg-white/[0.02] px-3 py-2">
                  <Film className="h-4 w-4 text-white/40" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-xs text-white/85">{r.filename}</div>
                    <div className="text-[10px] text-white/40">
                      {formatBytes(r.size)} · {new Date(r.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <Button variant="outline" onClick={() => setPlaying(r)}>
                    <Play className="h-3.5 w-3.5" />
                    Replay
                  </Button>
                  <a
                    href={`/api/recordings/${encodeURIComponent(r.filename)}`}
                    download
                    className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-[11px] text-white/70 hover:border-white/25 hover:text-white"
                  >
                    <Download className="h-3 w-3" />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {playing ? (
        <PlayerModal recording={playing} onClose={() => setPlaying(null)} />
      ) : null}
    </div>
  );
}

function PlayerModal({ recording, onClose }: { recording: Recording; onClose: () => void }) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let player: { dispose: () => void } | null = null;
    let cancelled = false;

    const init = () => {
      if (cancelled || !containerRef.current) return;
      if (!window.AsciinemaPlayer) {
        // Script hasn't loaded yet — try again shortly.
        setTimeout(init, 300);
        return;
      }
      try {
        containerRef.current.innerHTML = '';
        player = window.AsciinemaPlayer.create(
          `/api/recordings/${encodeURIComponent(recording.filename)}`,
          containerRef.current,
          { autoPlay: true, theme: 'monokai', terminalFontSize: 'small' },
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    };
    init();
    return () => {
      cancelled = true;
      try {
        player?.dispose();
      } catch {
        /* ignore */
      }
    };
  }, [recording.filename]);

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4" onClick={onClose}>
      <div className="flex h-[80vh] w-full max-w-5xl flex-col rounded-xl border border-neon-magenta/30 bg-bg-1 p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <span className="font-mono text-xs text-white/70">{recording.filename}</span>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </div>
        {error ? (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
            Player failed to load: {error}
          </div>
        ) : null}
        <div ref={containerRef} className="flex-1 overflow-auto rounded-md border border-white/10 bg-black/60" />
      </div>
    </div>
  );
}
