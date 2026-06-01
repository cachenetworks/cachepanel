import { NextResponse } from 'next/server';
import { z } from 'zod';
import { hasValidSetupCookie } from '@/lib/setup-token';
import { validateCloudflareCreds } from '@/lib/cloudflare';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const bodySchema = z.object({
  token: z.string().min(1),
  accountId: z.string().min(1),
});

export async function POST(req: Request) {
  if (!hasValidSetupCookie()) {
    return NextResponse.json({ ok: false, message: 'Setup session expired.' }, { status: 403 });
  }
  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: 'Missing token or account ID.' }, { status: 400 });
  }
  const result = await validateCloudflareCreds(parsed.data.token, parsed.data.accountId);
  return NextResponse.json(result);
}
