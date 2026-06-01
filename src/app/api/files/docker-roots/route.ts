import { NextResponse } from 'next/server';
import { authorize } from '@/lib/api-auth';
import { listDockerRoots } from '@/lib/docker-roots';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/files/docker-roots
// Returns one entry per (container × mount) so the file-manager sidebar can
// render "browse container volumes" shortcuts. Read-only — actual file ops
// still flow through the regular /api/files/* endpoints with the host path.
export async function GET() {
  const auth = await authorize();
  if (!auth.ok) return auth.response;
  try {
    const roots = await listDockerRoots();
    return NextResponse.json({ roots, count: roots.length });
  } catch (err) {
    return NextResponse.json(
      { roots: [], count: 0, error: err instanceof Error ? err.message : String(err) },
      { status: 200 }, // soft-fail — docker may not be reachable
    );
  }
}
