'use client';

import * as React from 'react';
import { io, type Socket } from 'socket.io-client';
import { Wifi, WifiOff, RotateCw, TerminalSquare } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useServer } from '@/components/layout/server-context';
import 'xterm/css/xterm.css';

interface ReadyInfo {
  pid: number;
  shell: string;
  cwd: string;
  user: string;
}

export function TerminalClient({ username, role }: { username: string; role: 'OWNER' | 'ADMIN' }) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const termRef = React.useRef<import('xterm').Terminal | null>(null);
  const fitRef = React.useRef<import('xterm-addon-fit').FitAddon | null>(null);
  const socketRef = React.useRef<Socket | null>(null);

  const { current } = useServer();
  const serverId = current?.id ?? null;
  const [status, setStatus] = React.useState<'connecting' | 'connected' | 'disconnected' | 'error'>('connecting');
  const [info, setInfo] = React.useState<ReadyInfo | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [reconnectKey, setReconnectKey] = React.useState(0);

  React.useEffect(() => {
    let disposed = false;
    let term: import('xterm').Terminal | null = null;
    let fit: import('xterm-addon-fit').FitAddon | null = null;
    let socket: Socket | null = null;
    let resizeObserver: ResizeObserver | null = null;

    (async () => {
      const [{ Terminal }, { FitAddon }, { WebLinksAddon }] = await Promise.all([
        import('xterm'),
        import('xterm-addon-fit'),
        import('xterm-addon-web-links'),
      ]);
      if (disposed || !containerRef.current) return;

      term = new Terminal({
        cursorBlink: true,
        fontFamily: 'JetBrains Mono, ui-monospace, SFMono-Regular, monospace',
        fontSize: 13,
        lineHeight: 1.25,
        allowProposedApi: true,
        theme: {
          background: '#06060a',
          foreground: '#e7e7ea',
          cursor: '#00F708',
          cursorAccent: '#06060a',
          selectionBackground: 'rgba(0,247,8,0.30)',
          black: '#0b0b0f',
          red: '#ff5c83',
          green: '#00F708',
          yellow: '#ffd166',
          blue: '#6ec6ff',
          magenta: '#E600FF',
          cyan: '#56d4dd',
          white: '#d8d8d8',
          brightBlack: '#5a5a64',
          brightRed: '#ff7a9c',
          brightGreen: '#5dff61',
          brightYellow: '#ffe28a',
          brightBlue: '#9ad7ff',
          brightMagenta: '#f37dff',
          brightCyan: '#80e3eb',
          brightWhite: '#ffffff',
        },
      });
      fit = new FitAddon();
      const links = new WebLinksAddon();
      term.loadAddon(fit);
      term.loadAddon(links);
      term.open(containerRef.current);
      try {
        fit.fit();
      } catch {
        /* container size not ready */
      }
      termRef.current = term;
      fitRef.current = fit;

      term.writeln('\x1b[1;32m✓\x1b[0m \x1b[2mConnecting to CachePanel terminal…\x1b[0m');

      socket = io({
        path: '/api/terminal/socket',
        // Start with polling so the session cookie is sent on the first HTTP
        // request, then upgrade to a WebSocket. Reliable behind Cloudflare.
        transports: ['polling', 'websocket'],
        withCredentials: true,
        reconnection: true,
        reconnectionAttempts: 4,
        reconnectionDelay: 1000,
        // Pass the active server id so server.js spawns ssh against it.
        query: serverId ? { server: serverId } : undefined,
      });
      socketRef.current = socket;

      socket.on('connect', () => {
        setStatus('connected');
      });
      socket.on('disconnect', () => {
        setStatus('disconnected');
      });
      socket.on('connect_error', (err) => {
        setStatus('error');
        setError(err.message);
        term?.writeln(`\x1b[1;31m✗\x1b[0m ${err.message}`);
      });
      socket.on('terminal:ready', (ready: ReadyInfo) => {
        setInfo(ready);
        try {
          fit?.fit();
          socket?.emit('terminal:resize', { cols: term?.cols, rows: term?.rows });
        } catch {
          /* fit may fail before paint */
        }
      });
      socket.on('terminal:data', (data: string) => {
        term?.write(data);
      });
      socket.on('terminal:exit', ({ exitCode }: { exitCode: number }) => {
        term?.writeln(`\r\n\x1b[2;33m[session ended — exit ${exitCode}]\x1b[0m`);
        setStatus('disconnected');
      });
      socket.on('terminal:error', (msg: string) => {
        setStatus('error');
        setError(msg);
        term?.writeln(`\r\n\x1b[1;31m${msg}\x1b[0m`);
      });

      term.onData((data) => socket?.emit('terminal:input', data));

      const fitNow = () => {
        if (!fit || !term) return;
        try {
          fit.fit();
          socket?.emit('terminal:resize', { cols: term.cols, rows: term.rows });
        } catch {
          /* swallow */
        }
      };
      window.addEventListener('resize', fitNow);
      resizeObserver = new ResizeObserver(fitNow);
      if (containerRef.current) resizeObserver.observe(containerRef.current);
      // Initial fit after first paint.
      requestAnimationFrame(fitNow);

      // Focus
      term.focus();

      // Cleanup hook
      return () => {
        window.removeEventListener('resize', fitNow);
      };
    })().catch((err) => {
      setError(err instanceof Error ? err.message : 'Failed to initialize terminal');
      setStatus('error');
    });

    return () => {
      disposed = true;
      try {
        resizeObserver?.disconnect();
      } catch {
        /* ignore */
      }
      try {
        socket?.disconnect();
      } catch {
        /* ignore */
      }
      try {
        term?.dispose();
      } catch {
        /* ignore */
      }
      termRef.current = null;
      fitRef.current = null;
      socketRef.current = null;
    };
  }, [reconnectKey, serverId]);

  const statusTone =
    status === 'connected' ? 'green' : status === 'error' || status === 'disconnected' ? 'red' : 'yellow';

  return (
    <div className="flex h-[calc(100vh-10rem)] flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-white">
            <TerminalSquare className="h-5 w-5 text-neon-green" />
            Terminal
          </h1>
          <p className="text-xs text-white/50">
            Session owner: <span className="text-white/80">{username}</span>{' '}
            <span className="text-white/30">·</span> Role:{' '}
            <span className={role === 'OWNER' ? 'neon-text-magenta' : 'neon-text-green'}>{role}</span>
            {info ? (
              <>
                {' · '}Shell <span className="text-white/80">{info.shell}</span> · PID{' '}
                <span className="text-white/80">{info.pid}</span> · User{' '}
                <span className="text-white/80">{info.user}</span>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={statusTone}>
            {status === 'connected' ? (
              <>
                <Wifi className="h-3 w-3" /> connected
              </>
            ) : status === 'error' ? (
              <>
                <WifiOff className="h-3 w-3" /> error
              </>
            ) : status === 'disconnected' ? (
              <>
                <WifiOff className="h-3 w-3" /> disconnected
              </>
            ) : (
              'connecting…'
            )}
          </Badge>
          <Button variant="outline" size="sm" onClick={() => setReconnectKey((k) => k + 1)}>
            <RotateCw className="h-3 w-3" />
            Reconnect
          </Button>
        </div>
      </div>
      {error && status === 'error' ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          {error}
        </div>
      ) : null}
      <Card className="relative flex-1 overflow-hidden p-0">
        <div ref={containerRef} className="h-full min-h-[400px] w-full" />
      </Card>
    </div>
  );
}
