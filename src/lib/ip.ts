import type { NextRequest } from 'next/server';
import type { IncomingMessage } from 'node:http';

export function getClientIp(req: NextRequest | IncomingMessage | Request): string {
  const headers =
    'headers' in req && typeof (req.headers as Headers).get === 'function'
      ? (req.headers as Headers)
      : null;

  const get = (name: string): string | null => {
    if (headers) return headers.get(name);
    const raw = (req as IncomingMessage).headers?.[name.toLowerCase()];
    if (Array.isArray(raw)) return raw[0] ?? null;
    return (raw as string) ?? null;
  };

  const xff = get('x-forwarded-for');
  if (xff) return xff.split(',')[0]!.trim();
  const real = get('x-real-ip');
  if (real) return real;
  const cf = get('cf-connecting-ip');
  if (cf) return cf;
  const remote = (req as IncomingMessage).socket?.remoteAddress;
  return remote ?? 'unknown';
}
