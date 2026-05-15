'use client';

import * as React from 'react';
import { Bot, Loader2, RefreshCw, Send, Server, Sparkles, Trash2, User, AlertTriangle } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty';
import { useToast } from '@/components/ui/toaster';
import { cn } from '@/lib/utils';

interface Message {
  id: number;
  role: 'user' | 'assistant';
  content: string;
}

interface OllamaModel {
  name: string;
}
interface OllamaStatus {
  available: boolean;
  base: string;
  defaultModel: string;
  version?: string;
  models: OllamaModel[];
  running: Array<{ name: string }>;
  error?: string;
}

const SYSTEM_PROMPT =
  'You are CachePanel Assistant, a concise Linux server expert helping the OWNER manage their Ubuntu host. Give short, specific answers. When the user asks for shell commands, prefer one-liners that work on a recent Ubuntu LTS. Never invent files or services that do not exist.';

export function AssistantClient() {
  const { toast } = useToast();
  const [status, setStatus] = React.useState<OllamaStatus | null>(null);
  const [model, setModel] = React.useState<string>('');
  const [input, setInput] = React.useState('');
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [streaming, setStreaming] = React.useState(false);
  const counter = React.useRef(0);
  const abortRef = React.useRef<AbortController | null>(null);
  const scrollerRef = React.useRef<HTMLDivElement | null>(null);

  const loadStatus = React.useCallback(async () => {
    try {
      const res = await fetch('/api/ollama', { cache: 'no-store' });
      const body = (await res.json()) as OllamaStatus;
      setStatus(body);
      if (!model) setModel(body.defaultModel || body.models[0]?.name || '');
    } catch (err) {
      toast({ variant: 'error', title: 'Could not query Ollama', description: err instanceof Error ? err.message : String(err) });
    }
  }, [model, toast]);

  React.useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  React.useEffect(() => {
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, streaming]);

  async function send() {
    const text = input.trim();
    if (!text || streaming || !model) return;

    counter.current += 1;
    const userMsg: Message = { id: counter.current, role: 'user', content: text };
    counter.current += 1;
    const assistantMsg: Message = { id: counter.current, role: 'assistant', content: '' };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput('');
    setStreaming(true);

    const wireMessages = [
      { role: 'system' as const, content: SYSTEM_PROMPT },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user' as const, content: text },
    ];

    abortRef.current = new AbortController();
    try {
      const res = await fetch('/api/ollama/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages: wireMessages }),
        signal: abortRef.current.signal,
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl = buffer.indexOf('\n');
        while (nl !== -1) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (line) {
            try {
              const chunk = JSON.parse(line) as {
                message?: { role?: string; content?: string };
                done?: boolean;
                error?: string;
              };
              if (chunk.error) throw new Error(chunk.error);
              const piece = chunk.message?.content;
              if (piece) {
                setMessages((prev) =>
                  prev.map((m) => (m.id === assistantMsg.id ? { ...m, content: m.content + piece } : m)),
                );
              }
            } catch (parseErr) {
              console.warn('[assistant] bad chunk', line, parseErr);
            }
          }
          nl = buffer.indexOf('\n');
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        const msg = err instanceof Error ? err.message : String(err);
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantMsg.id ? { ...m, content: `_(error: ${msg})_` } : m)),
        );
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  function clear() {
    setMessages([]);
  }

  return (
    <div className="flex h-[calc(100vh-9rem)] flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-white">
            <Sparkles className="h-5 w-5 text-neon-magenta" />
            Assistant
          </h1>
          <p className="text-xs text-white/50">
            Local AI via Ollama — runs entirely on your host. No data leaves the server.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {status ? (
            status.available ? (
              <Badge tone="green">
                <Server className="h-3 w-3" />
                Ollama {status.version ?? ''}
              </Badge>
            ) : (
              <Badge tone="red">
                <AlertTriangle className="h-3 w-3" />
                Ollama offline
              </Badge>
            )
          ) : (
            <Badge tone="neutral">checking…</Badge>
          )}
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            disabled={!status?.available || streaming}
            className="h-9 rounded-lg border border-white/10 bg-black/40 px-3 text-sm text-white outline-none focus:border-neon-green/40 disabled:opacity-50"
          >
            {status?.models.length ? (
              status.models.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.name}
                </option>
              ))
            ) : (
              <option value="">no models installed</option>
            )}
          </select>
          <Button variant="outline" size="sm" onClick={loadStatus} disabled={streaming}>
            <RefreshCw className="h-3 w-3" />
            Refresh
          </Button>
          <Button variant="ghost" size="sm" onClick={clear} disabled={streaming || messages.length === 0}>
            <Trash2 className="h-3 w-3" />
            Clear
          </Button>
        </div>
      </div>

      {status && !status.available ? (
        <Card>
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-yellow-300" />
            <div className="text-sm">
              <div className="font-medium text-white">Ollama is not reachable at {status.base}</div>
              <p className="mt-1 text-xs text-white/60">
                Install Ollama on your host (<code className="text-neon-green">curl -fsSL https://ollama.com/install.sh | sh</code>),
                pull a model (<code className="text-neon-green">ollama pull mistral</code>), and make sure it&apos;s listening
                on <code>0.0.0.0:11434</code> so CachePanel can reach it via <code>host.docker.internal</code>. You can override
                the URL with <code>OLLAMA_HOST</code> in your <code>.env</code>.
              </p>
              {status.error ? <p className="mt-2 text-xs text-red-300">{status.error}</p> : null}
            </div>
          </div>
        </Card>
      ) : null}

      <Card className="flex flex-1 flex-col overflow-hidden p-0">
        <div ref={scrollerRef} className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
          {messages.length === 0 ? (
            <EmptyState
              icon={<Bot className="h-8 w-8" />}
              title="Ask me anything about this server"
              description="I can suggest commands, explain logs, draft systemd units, help you debug. I see this conversation only — I do not have shell access."
            />
          ) : (
            messages.map((m) => (
              <div key={m.id} className={cn('flex gap-3', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                {m.role === 'assistant' ? (
                  <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-neon-magenta/30 bg-neon-magenta/10 text-neon-magenta">
                    <Bot className="h-3.5 w-3.5" />
                  </div>
                ) : null}
                <div
                  className={cn(
                    'max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
                    m.role === 'user'
                      ? 'bg-neon-green/15 text-neon-green border border-neon-green/30'
                      : 'bg-white/[0.03] text-white/90 border border-white/[0.06]',
                  )}
                >
                  {m.content || (m.role === 'assistant' && streaming ? <Loader2 className="h-4 w-4 animate-spin" /> : '')}
                </div>
                {m.role === 'user' ? (
                  <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-neon-green/30 bg-neon-green/10 text-neon-green">
                    <User className="h-3.5 w-3.5" />
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>

        <div className="border-t border-white/[0.04] p-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
            className="flex items-end gap-2"
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={1}
              placeholder={status?.available ? `Ask ${model || 'the model'}…  (Shift+Enter for newline)` : 'Ollama is offline'}
              disabled={!status?.available || streaming || !model}
              className="min-h-[44px] max-h-40 flex-1 resize-y rounded-lg border border-white/10 bg-black/40 px-3 py-2.5 text-sm text-white placeholder:text-white/40 outline-none focus:border-neon-magenta/40 focus:ring-2 focus:ring-neon-magenta/20 disabled:opacity-50"
            />
            {streaming ? (
              <Button type="button" variant="danger" onClick={stop}>
                Stop
              </Button>
            ) : (
              <Button type="submit" variant="magenta" disabled={!status?.available || !input.trim() || !model}>
                <Send className="h-4 w-4" />
                Send
              </Button>
            )}
          </form>
        </div>
      </Card>
    </div>
  );
}
