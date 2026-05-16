import { NextResponse } from 'next/server';
import { authorize } from '@/lib/api-auth';
import { runOnHost } from '@/lib/host-probe';
import { getRequestServerId } from '@/lib/req-server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Returns the same info as `docker system df` parsed into JSON-ish rows.
export async function GET(req: Request) {
  const auth = await authorize();
  if (!auth.ok) return auth.response;
  const serverId = getRequestServerId(req);
  const res = await runOnHost("docker system df --format '{{.Type}}|{{.Total}}|{{.Active}}|{{.Size}}|{{.Reclaimable}}' 2>/dev/null", {
    serverId,
    userId: auth.user.id,
  });
  if (res.code !== 0) {
    return NextResponse.json({ rows: [], error: res.stderr.trim() }, { status: 502 });
  }
  const rows = res.stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [type, total, active, size, reclaimable] = line.split('|');
      return { type, total, active, size, reclaimable };
    });
  return NextResponse.json({ rows });
}
