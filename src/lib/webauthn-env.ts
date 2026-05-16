import { getEnv } from './env';

// WebAuthn requires HTTPS, except on localhost. Derived from NEXTAUTH_URL so
// LAN-mode installs (plain HTTP) gracefully disable 2FA with a banner.
export interface WebAuthnEnv {
  available: boolean;
  rpID: string;
  rpName: string;
  origin: string;
  reason?: string;
}

export function getWebAuthnEnv(): WebAuthnEnv {
  const env = getEnv();
  let url: URL;
  try {
    url = new URL(env.NEXTAUTH_URL);
  } catch {
    return {
      available: false,
      rpID: 'localhost',
      rpName: 'CachePanel',
      origin: env.NEXTAUTH_URL,
      reason: 'NEXTAUTH_URL is not a valid URL',
    };
  }
  const isLocalhost =
    url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1';
  const isHttps = url.protocol === 'https:';
  if (!isHttps && !isLocalhost) {
    return {
      available: false,
      rpID: url.hostname,
      rpName: 'CachePanel',
      origin: url.origin,
      reason:
        'WebAuthn requires HTTPS. Put CachePanel behind a Cloudflare Tunnel or a reverse proxy with TLS to enable 2FA.',
    };
  }
  return {
    available: true,
    rpID: url.hostname,
    rpName: 'CachePanel',
    origin: url.origin,
  };
}
