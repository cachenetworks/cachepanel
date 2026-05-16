import { NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { authorize } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const RECORDINGS_DIR = process.env.RECORDINGS_DIR ?? '/app/data/recordings';

export async function GET() {
  const auth = await authorize({ requireOwner: true });
  if (!auth.ok) return auth.response;
  try {
    const entries = await fs.readdir(RECORDINGS_DIR, { withFileTypes: true }).catch(() => []);
    const files = entries
      .filter((e) => e.isFile() && e.name.endsWith('.cast'))
      .map((e) => {
        const s = statSync(join(RECORDINGS_DIR, e.name));
        return { filename: e.name, size: s.size, createdAt: s.mtime.toISOString() };
      })
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return NextResponse.json({ recordings: files });
  } catch (err) {
    return NextResponse.json({ recordings: [], error: err instanceof Error ? err.message : 'list failed' });
  }
}
