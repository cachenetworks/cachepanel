import { NextResponse } from 'next/server';
import { authorize } from '@/lib/api-auth';
import { audit } from '@/lib/audit';
import { getClientIp } from '@/lib/ip';
import { containerAction, removeContainer, type ContainerAction } from '@/lib/docker-api';
import { remoteContainerAction } from '@/lib/docker-remote';
import { getRequestServerId } from '@/lib/req-server';
import { getServerById } from '@/lib/servers';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const bodySchema = z.object({
  action: z.enum(['start', 'stop', 'restart', 'pause', 'unpause', 'kill', 'remove']),
  force: z.boolean().optional(),
});

// Container actions are destructive enough that ADMINs are blocked from the
// dangerous ones — only OWNER may remove or kill.
const OWNER_ONLY: Set<string> = new Set(['remove', 'kill']);

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await authorize();
  if (!auth.ok) return auth.response;

  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });

  const { action, force } = parsed.data;
  if (OWNER_ONLY.has(action) && auth.user.role !== 'OWNER') {
    return NextResponse.json({ error: `Only OWNER may ${action} containers.` }, { status: 403 });
  }
  if (!params.id || params.id.length < 4) {
    return NextResponse.json({ error: 'Invalid container id' }, { status: 400 });
  }

  const serverId = getRequestServerId(req);
  const server = await getServerById(serverId);
  const isPrimary = !!server?.isPrimary;

  try {
    if (isPrimary || !server) {
      if (action === 'remove') {
        await removeContainer(params.id, !!force);
      } else {
        await containerAction(params.id, action as ContainerAction);
      }
    } else {
      await remoteContainerAction(
        { server, userId: auth.user.id },
        params.id,
        action,
        !!force,
      );
    }
    await audit({
      userId: auth.user.id,
      action: 'settings.changed',
      target: `docker:${params.id}`,
      metadata: { action, force: !!force, serverId: server?.id ?? null },
      ipAddress: getClientIp(req),
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
