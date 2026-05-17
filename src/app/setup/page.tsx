import { redirect } from 'next/navigation';
import { isSetupMode, getManyConfig } from '@/lib/config';
import { claimSetupTokenFromUrl, hasValidSetupCookie } from '@/lib/setup-token';
import { getEnv } from '@/lib/env';
import { SetupClient } from './setup-client';

export const dynamic = 'force-dynamic';

export default async function SetupPage({
  searchParams,
}: {
  searchParams: { token?: string };
}) {
  // If setup is already done, /setup is closed — bounce to /login.
  if (!(await isSetupMode())) {
    redirect('/login');
  }

  // The user can land here two ways:
  //   1. ?token=<setup-token>   — first visit; we exchange for a cookie
  //   2. Already has cookie     — refreshing mid-wizard
  if (!hasValidSetupCookie()) {
    const t = searchParams.token ?? '';
    if (!t) {
      // No token, no cookie — show "where to find the token" hint.
      return <NoTokenHint />;
    }
    const ok = await claimSetupTokenFromUrl(t);
    if (!ok) {
      return <BadTokenHint />;
    }
  }

  // Hydrate the wizard with whatever the user has already saved on previous
  // visits — so refreshing mid-flow doesn't lose work.
  const initial = await getManyConfig([
    'discord_client_id',
    'discord_client_secret',
    'discord_guild_id',
    'discord_allowed_user_ids',
    'cloudflare_api_token',
    'cloudflare_account_id',
    'ollama_host',
    'ollama_model',
  ]);
  const env = getEnv();

  return <SetupClient initial={initial} publicUrl={env.NEXTAUTH_URL} />;
}

function NoTokenHint() {
  return (
    <div className="mx-auto mt-20 max-w-xl rounded-2xl border border-border bg-background-card p-8 text-center">
      <h1 className="text-xl font-semibold text-foreground">Setup token required</h1>
      <p className="mt-3 text-sm text-foreground-muted">
        Open the URL printed in the CachePanel container's logs:
      </p>
      <pre className="mt-3 rounded-md border border-border bg-background-elevated p-3 text-left font-mono text-xs text-foreground-muted">
docker logs cachepanel 2&gt;&amp;1 | grep -A1 'first-run setup'
      </pre>
      <p className="mt-4 text-[11px] text-foreground-subtle">
        The token is regenerated on every container restart while setup is incomplete.
      </p>
    </div>
  );
}

function BadTokenHint() {
  return (
    <div className="mx-auto mt-20 max-w-xl rounded-2xl border border-red-500/40 bg-red-500/10 p-8 text-center">
      <h1 className="text-xl font-semibold text-foreground">Invalid setup token</h1>
      <p className="mt-3 text-sm text-foreground-muted">
        That token doesn't match. Re-read it from the container logs — it changes on every restart.
      </p>
    </div>
  );
}
