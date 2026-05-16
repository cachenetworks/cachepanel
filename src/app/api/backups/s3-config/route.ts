import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorize } from '@/lib/api-auth';
import { audit } from '@/lib/audit';
import { setSetting } from '@/lib/settings';
import { getS3Config } from '@/lib/backup';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const auth = await authorize({ requireOwner: true });
  if (!auth.ok) return auth.response;
  const cfg = await getS3Config();
  // Never echo back the secret; UI just shows "set" vs "unset".
  if (!cfg) return NextResponse.json({ configured: false });
  return NextResponse.json({
    configured: true,
    endpoint: cfg.endpoint,
    region: cfg.region,
    bucket: cfg.bucket,
    prefix: cfg.prefix,
    accessKeyHint: cfg.accessKey.slice(0, 4) + '…' + cfg.accessKey.slice(-4),
  });
}

const updateSchema = z.object({
  endpoint: z.string().url(),
  region: z.string().min(1),
  bucket: z.string().min(1),
  accessKey: z.string().min(1),
  secretKey: z.string().min(1),
  prefix: z.string().optional().default(''),
});

export async function PUT(req: Request) {
  const auth = await authorize({ requireOwner: true });
  if (!auth.ok) return auth.response;
  const raw = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body', issues: parsed.error.issues }, { status: 400 });
  }
  await setSetting('backup.s3_endpoint', parsed.data.endpoint);
  await setSetting('backup.s3_region', parsed.data.region);
  await setSetting('backup.s3_bucket', parsed.data.bucket);
  await setSetting('backup.s3_access_key', parsed.data.accessKey);
  await setSetting('backup.s3_secret_key', parsed.data.secretKey);
  await setSetting('backup.s3_prefix', parsed.data.prefix);
  await audit({
    userId: auth.user.id,
    action: 'settings.changed',
    target: 'backup.s3_config',
    metadata: { bucket: parsed.data.bucket, endpoint: parsed.data.endpoint },
  });
  return NextResponse.json({ ok: true });
}
