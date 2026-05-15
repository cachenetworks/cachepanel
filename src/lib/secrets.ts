// Symmetric secret encryption for things stored in our own DB (DB connection
// passwords, etc). Key is derived from NEXTAUTH_SECRET so we don't need a
// separate KMS — rotating NEXTAUTH_SECRET invalidates stored secrets, which
// is the expected behavior.

import crypto from 'node:crypto';

const ALG = 'aes-256-gcm';
const IV_LEN = 12;

function getKey(): Buffer {
  const seed = process.env.NEXTAUTH_SECRET;
  if (!seed) throw new Error('NEXTAUTH_SECRET is required for secret encryption');
  return crypto.createHash('sha256').update('cachepanel-secret-v1::' + seed).digest();
}

export function encryptSecret(plain: string): string {
  if (plain === '') return '';
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALG, getKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: v1:<base64(iv)>:<base64(tag)>:<base64(ciphertext)>
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

export function decryptSecret(blob: string | null | undefined): string {
  if (!blob) return '';
  const parts = blob.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    // Treat anything we can't parse as plaintext for backwards compat with
    // imported / manually-edited rows. Don't throw — surface as empty.
    return '';
  }
  const iv = Buffer.from(parts[1]!, 'base64');
  const tag = Buffer.from(parts[2]!, 'base64');
  const ct = Buffer.from(parts[3]!, 'base64');
  try {
    const decipher = crypto.createDecipheriv(ALG, getKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf-8');
  } catch {
    return '';
  }
}
