import { NextResponse } from 'next/server';
import { authorize } from '@/lib/api-auth';
import { getDefaultModel, getOllamaBase } from '@/lib/ollama';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const messageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string().max(20_000),
});

const bodySchema = z.object({
  model: z.string().min(1).max(128).optional(),
  messages: z.array(messageSchema).min(1).max(60),
});

export async function POST(req: Request) {
  const auth = await authorize();
  if (!auth.ok) return auth.response;

  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body', issues: parsed.error.issues }, { status: 400 });
  }
  const { model = getDefaultModel(), messages } = parsed.data;

  const base = getOllamaBase();
  let upstream: Response;
  try {
    upstream = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        options: { num_ctx: 4096 },
      }),
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'Could not reach Ollama at ' + base + ': ' + (err instanceof Error ? err.message : String(err)) },
      { status: 502 },
    );
  }

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => upstream.statusText);
    return NextResponse.json({ error: `Ollama: ${text}` }, { status: upstream.status });
  }

  // Pipe Ollama's NDJSON stream straight back to the browser; the client
  // parses each line and renders the assistant's tokens incrementally.
  return new NextResponse(upstream.body, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    },
  });
}
