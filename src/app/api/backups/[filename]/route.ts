import { NextResponse } from 'next/server';
import { authorize } from '@/lib/api-auth';
import { audit } from '@/lib/audit';
import { deleteBackup, getBackupBuffer } from '@/lib/backup';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: { filename: string } }) {
  const auth = await authorize({ requireOwner: true });
  if (!auth.ok) return auth.response;

  try {
    const buf = await getBackupBuffer(params.filename);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'application/gzip',
        'Content-Length': String(buf.length),
        'Content-Disposition': `attachment; filename="${params.filename}"`,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Not found' },
      { status: 404 },
    );
  }
}

export async function DELETE(_req: Request, { params }: { params: { filename: string } }) {
  const auth = await authorize({ requireOwner: true });
  if (!auth.ok) return auth.response;
  try {
    await deleteBackup(params.filename);
    await audit({
      userId: auth.user.id,
      action: 'settings.changed',
      target: 'backup.deleted',
      metadata: { filename: params.filename },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Delete failed' },
      { status: 500 },
    );
  }
}
