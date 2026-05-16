import { requireApproved } from '@/lib/session';
import { getWebAuthnEnv } from '@/lib/webauthn-env';
import { SecurityClient } from './security-client';

export const dynamic = 'force-dynamic';

export default async function SecurityPage() {
  const user = await requireApproved();
  const env = getWebAuthnEnv();
  return (
    <SecurityClient
      user={user}
      webAuthnAvailable={env.available}
      webAuthnReason={env.reason ?? null}
    />
  );
}
