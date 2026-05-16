import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorize } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { runOnHost } from '@/lib/host-probe';
import { audit } from '@/lib/audit';

// Batch action: run a shell command (or a docker subcommand) on every server
// matching a tag OR an explicit list of server IDs. OWNER + ADMIN only,
// MFA-gated.

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const schema = z.object({
  // Use exactly one selector. If both are set, serverIds wins.
  serverIds: z.array(z.string()).optional(),
  tag: z.string().min(1).optional(),
  // Whitelisted action types — we don't accept arbitrary shell.
  action: z.enum(['restart-container', 'pull-image', 'compose-up', 'compose-down', 'custom-safe']),
  // For container-targeted actions: container name.
  containerName: z.string().optional(),
  // For compose actions: project dir.
  composeDir: z.string().optional(),
  // For custom-safe: pre-vetted, well-known commands only.
  customCommand: z.string().optional(),
});

const SAFE_CUSTOMS = new Set([
  'df -h',
  'uptime',
  'docker ps',
  'free -h',
  'systemctl status docker',
]);

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function buildCommand(input: z.infer<typeof schema>): string | null {
  switch (input.action) {
    case 'restart-container':
      if (!input.containerName) return null;
      return `docker restart ${shellQuote(input.containerName)}`;
    case 'pull-image':
      if (!input.containerName) return null;
      return `docker pull ${shellQuote(input.containerName)}`;
    case 'compose-up':
      if (!input.composeDir) return null;
      return `cd ${shellQuote(input.composeDir)} && docker compose up -d`;
    case 'compose-down':
      if (!input.composeDir) return null;
      return `cd ${shellQuote(input.composeDir)} && docker compose down`;
    case 'custom-safe':
      if (!input.customCommand || !SAFE_CUSTOMS.has(input.customCommand)) return null;
      return input.customCommand;
  }
}

export async function POST(req: Request) {
  const auth = await authorize({ requireMfa: true });
  if (!auth.ok) return auth.response;
  if (auth.user.role !== 'OWNER' && auth.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'OWNER or ADMIN required' }, { status: 403 });
  }

  const raw = await req.json().catch(() => null);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body', issues: parsed.error.issues }, { status: 400 });
  }

  const cmd = buildCommand(parsed.data);
  if (!cmd) {
    return NextResponse.json({ error: 'Invalid action or missing parameter' }, { status: 400 });
  }

  // Resolve target servers.
  let servers: Array<{ id: string; name: string; tags: string }> = [];
  if (parsed.data.serverIds?.length) {
    servers = await prisma.server.findMany({
      where: { id: { in: parsed.data.serverIds } },
      select: { id: true, name: true, tags: true },
    });
  } else if (parsed.data.tag) {
    const tag = parsed.data.tag.trim();
    const all = await prisma.server.findMany({ select: { id: true, name: true, tags: true } });
    servers = all.filter((s) =>
      s.tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
        .includes(tag),
    );
  } else {
    return NextResponse.json({ error: 'Provide serverIds or tag' }, { status: 400 });
  }

  if (servers.length === 0) {
    return NextResponse.json({ error: 'No matching servers' }, { status: 404 });
  }

  const results = await Promise.all(
    servers.map(async (s) => {
      const r = await runOnHost(cmd, { serverId: s.id, timeoutMs: 60_000 });
      return {
        serverId: s.id,
        serverName: s.name,
        code: r.code,
        stdout: r.stdout.slice(-4000),
        stderr: r.stderr.slice(-2000),
      };
    }),
  );

  await audit({
    userId: auth.user.id,
    action: 'settings.changed',
    target: `batch:${parsed.data.action}`,
    metadata: {
      action: parsed.data.action,
      servers: servers.map((s) => s.name),
      successCount: results.filter((r) => r.code === 0).length,
    },
  });

  return NextResponse.json({
    results,
    totalServers: servers.length,
    successCount: results.filter((r) => r.code === 0).length,
  });
}

// List unique tags across all servers — used by the UI for the "Group" picker.
export async function GET() {
  const auth = await authorize();
  if (!auth.ok) return auth.response;
  const all = await prisma.server.findMany({ select: { tags: true } });
  const tags = new Set<string>();
  for (const s of all) {
    for (const t of s.tags.split(',').map((x) => x.trim()).filter(Boolean)) {
      tags.add(t);
    }
  }
  return NextResponse.json({ tags: Array.from(tags).sort() });
}
