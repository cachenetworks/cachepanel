import { NextResponse } from 'next/server';
import { authorize } from '@/lib/api-auth';
import { runOnHost } from '@/lib/host-probe';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const auth = await authorize();
  if (!auth.ok) return auth.response;
  const start = Date.now();
  const r = await runOnHost('echo OK; uname -a; whoami', { serverId: params.id, userId: auth.user.id, timeoutMs: 6000 });
  const dur = Date.now() - start;
  if (r.code !== 0) {
    return NextResponse.json({
      ok: false,
      error: r.stderr || `ssh exited ${r.code}`,
      durationMs: dur,
    });
  }
  return NextResponse.json({ ok: true, output: r.stdout.trim(), durationMs: dur });
}
