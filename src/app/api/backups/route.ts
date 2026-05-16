import { NextResponse } from 'next/server';
import { authorize } from '@/lib/api-auth';
import { audit } from '@/lib/audit';
import { listBackups, createBackup, uploadBackupToS3, getS3Config } from '@/lib/backup';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const auth = await authorize({ requireOwner: true });
  if (!auth.ok) return auth.response;
  const backups = await listBackups();
  const s3 = await getS3Config();
  return NextResponse.json({
    backups,
    s3Configured: s3 !== null,
    s3Bucket: s3?.bucket ?? null,
  });
}

export async function POST(req: Request) {
  const auth = await authorize({ requireOwner: true });
  if (!auth.ok) return auth.response;

  let uploadToS3 = false;
  try {
    const body = await req.json().catch(() => ({}));
    uploadToS3 = body?.uploadToS3 === true;
  } catch {
    /* no body — defaults */
  }

  try {
    const info = await createBackup();
    let s3Result: { key: string; size: number } | null = null;
    if (uploadToS3) {
      try {
        s3Result = await uploadBackupToS3(info.filename);
      } catch (err) {
        await audit({
          userId: auth.user.id,
          action: 'settings.changed',
          target: 'backup.s3_upload_failed',
          metadata: { filename: info.filename, error: err instanceof Error ? err.message : String(err) },
        });
        return NextResponse.json({
          ...info,
          s3Error: err instanceof Error ? err.message : 'S3 upload failed',
        }, { status: 207 });
      }
    }
    await audit({
      userId: auth.user.id,
      action: 'settings.changed',
      target: 'backup.created',
      metadata: { filename: info.filename, size: info.size, uploadedToS3: !!s3Result },
    });
    return NextResponse.json({ ...info, s3: s3Result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'backup failed' },
      { status: 500 },
    );
  }
}
