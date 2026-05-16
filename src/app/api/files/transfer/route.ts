import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorize } from '@/lib/api-auth';
import { audit } from '@/lib/audit';
import { transferFiles, FileTransferError } from '@/lib/file-transfer';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const schema = z.object({
  sourceServerId: z.string().min(1),
  sourcePath: z.string().min(2).startsWith('/'),
  destServerId: z.string().min(1),
  destPath: z.string().min(2).startsWith('/'),
  mode: z.enum(['copy', 'move']),
});

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

  try {
    const result = await transferFiles({ ...parsed.data, userId: auth.user.id });
    await audit({
      userId: auth.user.id,
      action: 'file.uploaded',
      target: `${parsed.data.sourceServerId}:${parsed.data.sourcePath} → ${parsed.data.destServerId}:${parsed.data.destPath}`,
      metadata: {
        mode: parsed.data.mode,
        bytes: result.bytesTransferred,
        files: result.sourceFileCount,
        ms: result.durationMs,
      },
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof FileTransferError) {
      return NextResponse.json({ error: err.message }, { status: err.httpStatus });
    }
    console.error('[files/transfer] failed', err);
    return NextResponse.json({ error: 'Transfer failed' }, { status: 500 });
  }
}
