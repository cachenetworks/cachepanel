import { NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';
import { authorize } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const RECORDINGS_DIR = process.env.RECORDINGS_DIR ?? '/app/data/recordings';

export async function GET(_req: Request, { params }: { params: { filename: string } }) {
  const auth = await authorize({ requireOwner: true });
  if (!auth.ok) return auth.response;

  if (!/^[a-zA-Z0-9._-]+\.cast$/.test(params.filename)) {
    return NextResponse.json({ error: 'Invalid filename' }, { status: 400 });
  }
  const path = resolve(RECORDINGS_DIR, params.filename);
  if (!path.startsWith(resolve(RECORDINGS_DIR))) {
    return NextResponse.json({ error: 'Path traversal blocked' }, { status: 400 });
  }
  try {
    const buf = await fs.readFile(path);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'application/x-asciicast',
        'Content-Length': String(buf.length),
        'Content-Disposition': `inline; filename="${params.filename}"`,
      },
    });
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
}
