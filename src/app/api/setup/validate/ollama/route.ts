import { NextResponse } from 'next/server';
import { z } from 'zod';
import { hasValidSetupCookie } from '@/lib/setup-token';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const bodySchema = z.object({
  host: z.string().min(1),
  model: z.string().optional(),
});

interface OllamaTag {
  name: string;
  model?: string;
  size?: number;
}

interface OllamaTagsResp {
  models?: OllamaTag[];
}

export async function POST(req: Request) {
  if (!hasValidSetupCookie()) {
    return NextResponse.json({ ok: false, message: 'Setup session expired.' }, { status: 403 });
  }
  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: 'Missing host.' }, { status: 400 });
  }
  const host = parsed.data.host.trim().replace(/\/+$/, '');
  const model = (parsed.data.model ?? '').trim();

  if (!/^https?:\/\//.test(host)) {
    return NextResponse.json({
      ok: false,
      message: 'Host must include http:// or https:// — e.g. http://host.docker.internal:11434',
    });
  }

  const ctl = AbortSignal.timeout(5000);
  try {
    const res = await fetch(`${host}/api/tags`, { signal: ctl, cache: 'no-store' });
    if (!res.ok) {
      return NextResponse.json({
        ok: false,
        message: `Ollama returned HTTP ${res.status}. Is the service running? Try: curl ${host}/api/tags`,
      });
    }
    const data = (await res.json()) as OllamaTagsResp;
    const names = (data.models ?? []).map((m) => m.name);
    if (names.length === 0) {
      return NextResponse.json({
        ok: false,
        message: `Ollama is reachable but has no models. Run: ollama pull ${model || 'mistral'}`,
        availableModels: [],
      });
    }
    if (model && !names.some((n) => n === model || n.startsWith(`${model}:`))) {
      return NextResponse.json({
        ok: false,
        message: `Ollama is reachable, but model "${model}" isn't installed. Available: ${names.slice(0, 8).join(', ')}${names.length > 8 ? `, +${names.length - 8} more` : ''}`,
        availableModels: names,
      });
    }
    return NextResponse.json({
      ok: true,
      message: `Connected. ${names.length} model${names.length === 1 ? '' : 's'} available${model ? `, "${model}" found` : ''}.`,
      availableModels: names,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    let hint = '';
    if (/ECONNREFUSED|fetch failed/i.test(msg)) {
      hint = ` — is the Ollama service running? If CachePanel is in Docker and Ollama is on the host, the host should be http://host.docker.internal:11434 (Linux requires extra_hosts in docker-compose).`;
    } else if (/ENOTFOUND|getaddrinfo/i.test(msg)) {
      hint = ` — the hostname couldn't be resolved.`;
    } else if (/aborted|timeout/i.test(msg)) {
      hint = ` — timed out after 5s.`;
    }
    return NextResponse.json({ ok: false, message: `Couldn't reach Ollama${hint}` });
  }
}
