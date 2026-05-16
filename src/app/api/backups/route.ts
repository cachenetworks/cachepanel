import { NextResponse } from 'next/server';
import { authorize } from '@/lib/api-auth';
import { audit } from '@/lib/audit';
import { listBackups, createBackup } from '@/lib/backup';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const auth = await authorize({ requireOwner: true });
  if (!auth.ok) return auth.response;
  const backups = await listBackups();
  return NextResponse.json({ backups });
}

export async function POST() {
  const auth = await authorize({ requireOwner: true });
  if (!auth.ok) return auth.response;
  try {
    const info = await createBackup();
    await audit({
      userId: auth.user.id,
      action: 'settings.changed',
      target: 'backup.created',
      metadata: { filename: info.filename, size: info.size },
    });
    return NextResponse.json(info);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'backup failed' },
      { status: 500 },
    );
  }
}
