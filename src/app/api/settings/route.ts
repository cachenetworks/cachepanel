import { NextResponse } from 'next/server';
import { authorize } from '@/lib/api-auth';
import { audit } from '@/lib/audit';
import { getClientIp } from '@/lib/ip';
import { getEnv } from '@/lib/env';
import { adminCanApproveUsers, getBool, setSetting } from '@/lib/settings';
import { settingsUpdateSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await authorize();
  if (!auth.ok) return auth.response;
  const env = getEnv();
  const [adminApprove, allowDotenv, terminalEnabled, terminalAuditCommands] = await Promise.all([
    adminCanApproveUsers(),
    getBool('allow_dotenv_access', env.ALLOW_DOTENV_ACCESS),
    getBool('terminal_enabled', env.TERMINAL_ENABLED),
    getBool('terminal_audit_commands', env.TERMINAL_AUDIT_COMMANDS),
  ]);
  return NextResponse.json({
    settings: {
      admin_can_approve_users: adminApprove,
      allow_dotenv_access: allowDotenv,
      terminal_enabled: terminalEnabled,
      terminal_audit_commands: terminalAuditCommands,
    },
    env: {
      allowed_file_roots: env.ALLOWED_FILE_ROOTS,
      discord_guild_id: env.DISCORD_GUILD_ID || null,
      discord_role_check: env.DISCORD_ALLOWED_ROLE_IDS.length > 0,
      discord_user_allowlist_count: env.DISCORD_ALLOWED_USER_IDS.split(',').map((s) => s.trim()).filter(Boolean).length,
      terminal_shell: env.TERMINAL_SHELL,
      terminal_user: env.TERMINAL_USER || null,
      terminal_start_dir: env.TERMINAL_START_DIR,
    },
  });
}

export async function PUT(req: Request) {
  const auth = await authorize({ requireOwner: true });
  if (!auth.ok) return auth.response;

  const raw = await req.json().catch(() => null);
  const parsed = settingsUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body', issues: parsed.error.issues }, { status: 400 });
  }

  const changes: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed.data)) {
    if (typeof v === 'boolean') {
      await setSetting(k, v ? 'true' : 'false');
      changes[k] = v ? 'true' : 'false';
    }
  }
  await audit({
    userId: auth.user.id,
    action: 'settings.changed',
    target: 'app_settings',
    metadata: { changes },
    ipAddress: getClientIp(req),
  });
  return NextResponse.json({ ok: true });
}
