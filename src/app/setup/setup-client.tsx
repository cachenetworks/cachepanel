'use client';

import * as React from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Copy,
  ExternalLink,
  Loader2,
  Server,
  ShieldCheck,
  Sparkles,
  TestTube,
} from 'lucide-react';

// ----------------------------------------------------------------------------
// Wizard contract
// ----------------------------------------------------------------------------

type Step =
  | 'welcome'
  | 'discord'
  | 'access'
  | 'docker'
  | 'cloudflare'
  | 'ollama'
  | 'finish';

const STEPS: Step[] = [
  'welcome',
  'discord',
  'access',
  'docker',
  'cloudflare',
  'ollama',
  'finish',
];

const STEP_LABEL: Record<Step, string> = {
  welcome: 'Welcome',
  discord: 'Discord',
  access: 'Access',
  docker: 'Docker',
  cloudflare: 'Cloudflare',
  ollama: 'AI assistant',
  finish: 'Finish',
};

interface Initial {
  discord_client_id: string;
  discord_client_secret: string;
  discord_guild_id: string;
  discord_allowed_user_ids: string[];
  cloudflare_api_token: string;
  cloudflare_account_id: string;
  ollama_host: string;
  ollama_model: string;
  ssh_host: string;
  ssh_port: number;
  ssh_user: string;
  ssh_key_path: string;
  terminal_enabled: boolean;
  terminal_shell: string;
  terminal_user: string;
}

interface Context {
  publicUrl: string;
  callbackUrl: string;
  looksLocal: boolean;
  looksHttps: boolean;
  interfaces: Array<{ name: string; address: string; family: 'IPv4' | 'IPv6' }>;
  dockerSocketMounted: boolean;
  platform: string;
}

interface Props {
  initial: Initial;
  publicUrl: string;
}

interface TestResult {
  ok: boolean;
  message: string;
  // arbitrary extra fields the endpoints return
  [k: string]: unknown;
}

// ----------------------------------------------------------------------------
// Top-level wizard
// ----------------------------------------------------------------------------

export function SetupClient({ initial, publicUrl }: Props) {
  const [step, setStep] = React.useState<Step>('welcome');
  const [draft, setDraft] = React.useState<Initial>(initial);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [context, setContext] = React.useState<Context | null>(null);

  React.useEffect(() => {
    fetch('/api/setup/context')
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => c && setContext(c))
      .catch(() => undefined);
  }, []);

  const stepIdx = STEPS.indexOf(step);

  // Save a partial draft. The /save endpoint silently skips keys it doesn't
  // recognize, so we can flush anything that's in the local state.
  async function save(patch: Partial<Initial>): Promise<boolean> {
    setSaving(true);
    setError(null);
    try {
      // Convert arrays + numbers + booleans to what the wire wants.
      const wirePatch: Record<string, string | string[]> = {};
      for (const [k, v] of Object.entries(patch)) {
        if (Array.isArray(v)) wirePatch[k] = v;
        else if (typeof v === 'boolean') wirePatch[k] = v ? 'true' : 'false';
        else if (typeof v === 'number') wirePatch[k] = String(v);
        else if (typeof v === 'string') wirePatch[k] = v;
      }
      const res = await fetch('/api/setup/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(wirePatch),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Save failed');
      setDraft((prev) => ({ ...prev, ...patch }));
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function complete() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/setup/complete', { method: 'POST' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Complete failed');
      window.location.href = '/login';
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  }

  function goto(next: Step) {
    setError(null);
    setStep(next);
  }

  function prev() {
    const i = STEPS.indexOf(step);
    if (i > 0) goto(STEPS[i - 1]!);
  }
  function next() {
    const i = STEPS.indexOf(step);
    if (i < STEPS.length - 1) goto(STEPS[i + 1]!);
  }

  return (
    <div className="mx-auto mt-10 max-w-3xl px-4 pb-16">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          CachePanel first-run setup
        </h1>
        <p className="mt-1 text-sm text-foreground-muted">
          Wires up Discord login plus optional integrations — each section has a "Test" button
          that hits the real service so you know it works before saving. All values are editable
          later from <strong>Settings</strong>.
        </p>
      </header>

      <Stepper current={stepIdx} />

      <div className="mt-6 rounded-2xl border border-border bg-background-card p-6">
        {error ? (
          <div className="mb-4 flex gap-2 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-300">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}

        {step === 'welcome' && (
          <WelcomeStep publicUrl={publicUrl} context={context} onNext={next} />
        )}
        {step === 'discord' && (
          <DiscordStep
            draft={draft}
            callbackUrl={context?.callbackUrl ?? `${publicUrl}/api/auth/callback/discord`}
            saving={saving}
            onSave={save}
            onBack={prev}
            onNext={next}
          />
        )}
        {step === 'access' && (
          <AccessStep draft={draft} saving={saving} onSave={save} onBack={prev} onNext={next} />
        )}
        {step === 'docker' && (
          <DockerStep
            draft={draft}
            saving={saving}
            onSave={save}
            onBack={prev}
            onNext={next}
          />
        )}
        {step === 'cloudflare' && (
          <CloudflareStep
            draft={draft}
            publicUrl={publicUrl}
            saving={saving}
            onSave={save}
            onBack={prev}
            onNext={next}
          />
        )}
        {step === 'ollama' && (
          <OllamaStep draft={draft} saving={saving} onSave={save} onBack={prev} onNext={next} />
        )}
        {step === 'finish' && (
          <FinishStep
            draft={draft}
            saving={saving}
            onComplete={complete}
            onBack={prev}
            onJump={goto}
          />
        )}
      </div>

      <Style />
    </div>
  );
}

function Stepper({ current }: { current: number }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-2 text-xs text-foreground-subtle">
      {STEPS.map((s, i) => (
        <li key={s} className="flex items-center gap-2">
          <span
            className={
              i < current
                ? 'flex h-6 w-6 items-center justify-center rounded-full border border-neon-green/40 bg-neon-green/10 text-neon-green'
                : i === current
                  ? 'flex h-6 w-6 items-center justify-center rounded-full border border-neon-magenta/40 bg-neon-magenta/10 text-neon-magenta'
                  : 'flex h-6 w-6 items-center justify-center rounded-full border border-border text-foreground-subtle'
            }
          >
            {i < current ? <CheckCircle2 className="h-3 w-3" /> : i + 1}
          </span>
          <span className={i === current ? 'text-foreground' : ''}>{STEP_LABEL[s]}</span>
          {i < STEPS.length - 1 ? <ChevronRight className="h-3 w-3" /> : null}
        </li>
      ))}
    </ol>
  );
}

// ----------------------------------------------------------------------------
// Welcome
// ----------------------------------------------------------------------------

function WelcomeStep({
  publicUrl,
  context,
  onNext,
}: {
  publicUrl: string;
  context: Context | null;
  onNext: () => void;
}) {
  return (
    <div>
      <h2 className="text-lg font-semibold text-foreground">Welcome.</h2>
      <p className="mt-2 text-sm text-foreground-muted">
        Six steps, mostly optional. Saves to the database — not <code>.env</code> — so you can
        come back and change anything from <strong>Settings</strong> later.
      </p>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <Tile
          icon={<Sparkles className="h-4 w-4 text-neon-magenta" />}
          label="Public URL"
          value={publicUrl}
        />
        <Tile
          icon={<Server className="h-4 w-4 text-neon-green" />}
          label="Platform"
          value={context?.platform ?? '…'}
        />
        <Tile
          icon={<ShieldCheck className="h-4 w-4 text-neon-magenta" />}
          label="Discord callback"
          value={context?.callbackUrl ?? `${publicUrl}/api/auth/callback/discord`}
          mono
        />
        <Tile
          icon={<TestTube className="h-4 w-4 text-neon-green" />}
          label="Docker socket"
          value={
            context === null
              ? '…'
              : context.dockerSocketMounted
                ? 'Mounted (we’ll test it next)'
                : 'Not mounted'
          }
          warn={context !== null && !context.dockerSocketMounted}
        />
      </div>

      {context?.looksLocal ? (
        <Notice tone="warn">
          Your public URL is a local/LAN address. If you plan to expose CachePanel publicly via
          Cloudflare Tunnel, set <code>NEXTAUTH_URL</code> in <code>.env</code> (or use the
          Cloudflare step in this wizard) and restart the container <strong>before</strong>{' '}
          finishing setup. Otherwise Discord OAuth will redirect to the wrong host.
        </Notice>
      ) : null}

      {context && context.interfaces.length > 1 ? (
        <details className="mt-4 text-xs text-foreground-subtle">
          <summary className="cursor-pointer hover:text-foreground">
            Detected network interfaces ({context.interfaces.length})
          </summary>
          <ul className="mt-2 space-y-1 pl-4">
            {context.interfaces.map((i, idx) => (
              <li key={idx} className="font-mono">
                {i.name} · {i.address} ({i.family})
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <FooterRow right={<PrimaryButton onClick={onNext}>Begin setup <ChevronRight className="h-4 w-4" /></PrimaryButton>} />
    </div>
  );
}

// ----------------------------------------------------------------------------
// Discord
// ----------------------------------------------------------------------------

function DiscordStep({
  draft,
  callbackUrl,
  saving,
  onSave,
  onBack,
  onNext,
}: {
  draft: Initial;
  callbackUrl: string;
  saving: boolean;
  onSave: (patch: Partial<Initial>) => Promise<boolean>;
  onBack: () => void;
  onNext: () => void;
}) {
  const [clientId, setClientId] = React.useState(draft.discord_client_id);
  const [clientSecret, setClientSecret] = React.useState(draft.discord_client_secret);
  const [test, setTest] = React.useState<TestResult | null>(null);
  const [testing, setTesting] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  function copy() {
    navigator.clipboard.writeText(callbackUrl).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function runTest() {
    setTesting(true);
    setTest(null);
    try {
      const res = await fetch('/api/setup/validate/discord', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: clientId.trim(), clientSecret: clientSecret.trim() }),
      });
      setTest(await res.json());
    } catch (err) {
      setTest({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setTesting(false);
    }
  }

  async function onSaveContinue() {
    const saved = await onSave({
      discord_client_id: clientId.trim(),
      discord_client_secret: clientSecret.trim(),
    });
    if (saved) onNext();
  }

  return (
    <div>
      <StepHeader
        title="Discord OAuth"
        subtitle="The only required step — CachePanel uses Discord for login."
      />

      <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-foreground-muted">
        <li>
          Open the{' '}
          <a
            href="https://discord.com/developers/applications"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-neon-green hover:underline"
          >
            Discord developer portal <ExternalLink className="h-3 w-3" />
          </a>{' '}
          and create a new application named CachePanel.
        </li>
        <li>
          Open the <strong>OAuth2</strong> tab → <strong>Redirects</strong> → add this URL exactly:
        </li>
      </ol>

      <div className="mt-3 flex items-center gap-2 rounded-md border border-border bg-background-elevated p-3">
        <code className="flex-1 break-all font-mono text-xs text-neon-green">{callbackUrl}</code>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-foreground-muted hover:text-foreground"
        >
          {copied ? <CheckCircle2 className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-foreground-muted" start={3}>
        <li>Copy the <strong>CLIENT ID</strong> from "Client information".</li>
        <li>Click <strong>Reset Secret</strong> and copy the new value (don&apos;t use the Bot Token).</li>
      </ol>

      <div className="mt-5 space-y-3">
        <Field label="Discord Client ID">
          <input
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="17-25 digit number from Client information"
            className="cp-input"
          />
        </Field>
        <Field label="Discord Client Secret">
          <input
            type="password"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            placeholder="random string from Reset Secret"
            className="cp-input"
          />
        </Field>
      </div>

      <TestRow
        canTest={Boolean(clientId.trim() && clientSecret.trim())}
        testing={testing}
        onTest={runTest}
        result={test}
      />

      <FooterRow
        left={<SecondaryButton onClick={onBack}>Back</SecondaryButton>}
        right={
          <PrimaryButton
            disabled={saving || !clientId.trim() || !clientSecret.trim()}
            onClick={onSaveContinue}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save &amp; continue <ChevronRight className="h-4 w-4" />
          </PrimaryButton>
        }
      />
    </div>
  );
}

// ----------------------------------------------------------------------------
// Access (guild + allowlist)
// ----------------------------------------------------------------------------

function AccessStep({
  draft,
  saving,
  onSave,
  onBack,
  onNext,
}: {
  draft: Initial;
  saving: boolean;
  onSave: (patch: Partial<Initial>) => Promise<boolean>;
  onBack: () => void;
  onNext: () => void;
}) {
  const [guildId, setGuildId] = React.useState(draft.discord_guild_id);
  const [allowList, setAllowList] = React.useState(draft.discord_allowed_user_ids.join(', '));

  async function saveAndNext() {
    const ok = await onSave({
      discord_guild_id: guildId.trim(),
      discord_allowed_user_ids: allowList
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    });
    if (ok) onNext();
  }

  return (
    <div>
      <StepHeader
        title="Access control"
        subtitle="Optional gates around who can log in. Leave blank to allow any Discord user to attempt sign-in (you still approve them inside the panel)."
      />

      <div className="mt-5 space-y-4">
        <Field
          label="Restrict to one Discord server (guild ID)"
          hint="If set, only members of this guild can sign in. Get it from Discord → Server Settings → Widget → Server ID, or right-click the server icon with Developer Mode enabled."
        >
          <input
            value={guildId}
            onChange={(e) => setGuildId(e.target.value)}
            placeholder="optional · 17-20 digit number"
            className="cp-input"
          />
        </Field>
        <Field
          label="User-ID allowlist (comma-separated)"
          hint="Strictest gate. If set, ONLY these Discord IDs may attempt login. Useful for solo-admin setups."
        >
          <textarea
            value={allowList}
            onChange={(e) => setAllowList(e.target.value)}
            placeholder="123456789012345678, 987654321098765432"
            className="cp-input min-h-[60px]"
          />
        </Field>
      </div>

      <FooterRow
        left={<SecondaryButton onClick={onBack}>Back</SecondaryButton>}
        right={
          <div className="flex gap-2">
            <SecondaryButton onClick={onNext} disabled={saving}>
              Skip
            </SecondaryButton>
            <PrimaryButton disabled={saving} onClick={saveAndNext}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save &amp; continue <ChevronRight className="h-4 w-4" />
            </PrimaryButton>
          </div>
        }
      />
    </div>
  );
}

// ----------------------------------------------------------------------------
// Docker
// ----------------------------------------------------------------------------

function DockerStep({
  draft,
  saving,
  onSave,
  onBack,
  onNext,
}: {
  draft: Initial;
  saving: boolean;
  onSave: (patch: Partial<Initial>) => Promise<boolean>;
  onBack: () => void;
  onNext: () => void;
}) {
  const [test, setTest] = React.useState<TestResult | null>(null);
  const [testing, setTesting] = React.useState(false);
  const [autoRan, setAutoRan] = React.useState(false);

  const [sshHost, setSshHost] = React.useState(draft.ssh_host);
  const [sshPort, setSshPort] = React.useState(String(draft.ssh_port || 22));
  const [sshUser, setSshUser] = React.useState(draft.ssh_user);
  const [sshKey, setSshKey] = React.useState(draft.ssh_key_path);
  const [termShell, setTermShell] = React.useState(draft.terminal_shell || '/bin/bash');
  const [termUser, setTermUser] = React.useState(draft.terminal_user);

  // Auto-run the docker socket test on first mount so the user sees the
  // status immediately instead of having to click.
  React.useEffect(() => {
    if (autoRan) return;
    setAutoRan(true);
    runTest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runTest() {
    setTesting(true);
    setTest(null);
    try {
      const res = await fetch('/api/setup/validate/docker', { method: 'POST' });
      setTest(await res.json());
    } catch (err) {
      setTest({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setTesting(false);
    }
  }

  async function saveAndNext() {
    const portNum = Number.parseInt(sshPort, 10);
    const ok = await onSave({
      ssh_host: sshHost.trim(),
      ssh_port: Number.isFinite(portNum) ? portNum : 22,
      ssh_user: sshUser.trim(),
      ssh_key_path: sshKey.trim(),
      terminal_shell: termShell.trim() || '/bin/bash',
      terminal_user: termUser.trim(),
    });
    if (ok) onNext();
  }

  return (
    <div>
      <StepHeader
        title="Docker + host shell"
        subtitle="CachePanel needs the Docker socket to manage containers, and (optionally) SSH-to-itself to run shell commands as the panel's primary server."
      />

      <Section title="Docker daemon access">
        <p className="text-xs text-foreground-muted">
          The panel talks to <code>/var/run/docker.sock</code> directly. Click below to verify
          the bind mount and group permission are right.
        </p>
        <div className="mt-3">
          <TestRow canTest testing={testing} onTest={runTest} result={test} />
        </div>
        {test && !test.ok && (test.stage === 'permission-denied' || test.stage === 'socket-missing') ? (
          <AutoFixDocker
            stage={test.stage as 'permission-denied' | 'socket-missing'}
            socketGid={test.socketGid as number | undefined}
            oneliner={test.autoFixOneliner as string | undefined}
            onRetest={runTest}
          />
        ) : null}
      </Section>

      <Section title="SSH-to-host (optional, but recommended)" wide>
        <p className="text-xs text-foreground-muted">
          So the panel can <em>run shell commands on its own host</em>. Required for the built-in
          terminal, scheduled jobs, file manager beyond the container, and treating this box as
          the panel&apos;s <strong>primary</strong> managed server. <strong className="text-foreground">Fill this in
          and the install host shows up in the server picker as soon as you click Finish</strong> —
          no extra Add-Server step. Leave blank if you only want to manage containers.
        </p>
        <p className="mt-1 text-[11px] text-foreground-subtle">
          Tip: if CachePanel is running in Docker on the same box you want to manage, host can be{' '}
          <code>host.docker.internal</code> and user is whatever Linux account exists there (often{' '}
          <code>root</code> or a dedicated <code>cache</code>).
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Host or IP">
            <input
              value={sshHost}
              onChange={(e) => setSshHost(e.target.value)}
              placeholder="host.docker.internal"
              className="cp-input"
            />
          </Field>
          <Field label="Port">
            <input
              value={sshPort}
              onChange={(e) => setSshPort(e.target.value)}
              placeholder="22"
              className="cp-input"
            />
          </Field>
          <Field label="SSH user">
            <input
              value={sshUser}
              onChange={(e) => setSshUser(e.target.value)}
              placeholder="cache"
              className="cp-input"
            />
          </Field>
          <Field label="Path to private key inside container">
            <input
              value={sshKey}
              onChange={(e) => setSshKey(e.target.value)}
              placeholder="/run/secrets/cachepanel_id_ed25519"
              className="cp-input"
            />
          </Field>
        </div>
      </Section>

      <Section title="Terminal defaults" wide>
        <div className="mt-1 grid gap-3 sm:grid-cols-2">
          <Field label="Shell">
            <input
              value={termShell}
              onChange={(e) => setTermShell(e.target.value)}
              placeholder="/bin/bash"
              className="cp-input"
            />
          </Field>
          <Field label="Run terminal as user (optional)">
            <input
              value={termUser}
              onChange={(e) => setTermUser(e.target.value)}
              placeholder="cache"
              className="cp-input"
            />
          </Field>
        </div>
      </Section>

      <FooterRow
        left={<SecondaryButton onClick={onBack}>Back</SecondaryButton>}
        right={
          <div className="flex gap-2">
            <SecondaryButton onClick={onNext} disabled={saving}>
              Skip
            </SecondaryButton>
            <PrimaryButton disabled={saving} onClick={saveAndNext}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save &amp; continue <ChevronRight className="h-4 w-4" />
            </PrimaryButton>
          </div>
        }
      />
    </div>
  );
}

// ----------------------------------------------------------------------------
// Cloudflare — three modes: skip, save-creds-only, provision-tunnel
// ----------------------------------------------------------------------------

interface ProvisionResult {
  ok: boolean;
  message: string;
  tunnelToken?: string | null;
  tunnelName?: string;
  hostname?: string;
  zone?: string;
  dockerCmd?: string | null;
  debianCmd?: string | null;
  windowsCmd?: string | null;
}

function CloudflareStep({
  draft,
  publicUrl,
  saving,
  onSave,
  onBack,
  onNext,
}: {
  draft: Initial;
  publicUrl: string;
  saving: boolean;
  onSave: (patch: Partial<Initial>) => Promise<boolean>;
  onBack: () => void;
  onNext: () => void;
}) {
  const [token, setToken] = React.useState(draft.cloudflare_api_token);
  const [account, setAccount] = React.useState(draft.cloudflare_account_id);
  const [hostname, setHostname] = React.useState(() => {
    try {
      return new URL(publicUrl).host;
    } catch {
      return '';
    }
  });
  const [tunnelName, setTunnelName] = React.useState('cachepanel');
  const [localService, setLocalService] = React.useState('http://localhost:8992');

  const [test, setTest] = React.useState<TestResult | null>(null);
  const [testing, setTesting] = React.useState(false);
  const [provisioning, setProvisioning] = React.useState(false);
  const [provision, setProvision] = React.useState<ProvisionResult | null>(null);

  async function runTest() {
    setTesting(true);
    setTest(null);
    setProvision(null);
    try {
      const res = await fetch('/api/setup/validate/cloudflare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.trim(), accountId: account.trim() }),
      });
      setTest(await res.json());
    } catch (err) {
      setTest({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setTesting(false);
    }
  }

  async function runProvision() {
    setProvisioning(true);
    setProvision(null);
    try {
      const res = await fetch('/api/setup/provision-tunnel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: token.trim(),
          accountId: account.trim(),
          hostname: hostname.trim(),
          tunnelName: tunnelName.trim(),
          localService: localService.trim(),
        }),
      });
      const data = (await res.json()) as ProvisionResult;
      setProvision(data);
      // Mark test as passing too — if provision worked, creds are valid.
      if (data.ok) setTest({ ok: true, message: 'Creds valid; tunnel ready.' });
    } catch (err) {
      setProvision({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setProvisioning(false);
    }
  }

  async function saveCredsAndNext() {
    const ok = await onSave({
      cloudflare_api_token: token.trim(),
      cloudflare_account_id: account.trim(),
    });
    if (ok) onNext();
  }

  return (
    <div>
      <StepHeader
        title="Cloudflare Tunnel (optional)"
        subtitle="Skip entirely if you don't use Cloudflare. Save API creds only for the in-panel Tunnels page. Or provision an entire tunnel + DNS + ingress here."
      />

      <Section title="API credentials">
        <p className="text-xs text-foreground-muted">
          Create a token at{' '}
          <a
            href="https://dash.cloudflare.com/profile/api-tokens"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-neon-green hover:underline"
          >
            dash.cloudflare.com/profile/api-tokens <ExternalLink className="h-3 w-3" />
          </a>{' '}
          with scopes: <code>Account · Cloudflare Tunnel · Edit</code> and{' '}
          <code>Zone · DNS · Edit</code>. Account ID is in the right sidebar of any zone&apos;s
          overview page.
        </p>

        <div className="mt-3 space-y-3">
          <Field label="API token">
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="long random string from the Cloudflare dashboard"
              className="cp-input"
            />
          </Field>
          <Field label="Account ID">
            <input
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              placeholder="32 hex characters"
              className="cp-input"
            />
          </Field>
        </div>

        <TestRow
          canTest={Boolean(token.trim() && account.trim())}
          testing={testing}
          onTest={runTest}
          result={test}
        />
      </Section>

      <Section title="Provision tunnel automatically (recommended)" wide>
        <p className="text-xs text-foreground-muted">
          Optional. Creates (or reuses) a Cloudflare Tunnel, adds the DNS record for{' '}
          <code>{hostname || 'your-hostname'}</code>, and hands back the connector token + the
          command to run on your server.
        </p>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Public hostname">
            <input
              value={hostname}
              onChange={(e) => setHostname(e.target.value)}
              placeholder="panel.example.com"
              className="cp-input"
            />
          </Field>
          <Field label="Tunnel name">
            <input
              value={tunnelName}
              onChange={(e) => setTunnelName(e.target.value)}
              placeholder="cachepanel"
              className="cp-input"
            />
          </Field>
          <Field label="Local service the tunnel routes to" hint="Where the cloudflared connector forwards to. Default fits a single-host install.">
            <input
              value={localService}
              onChange={(e) => setLocalService(e.target.value)}
              placeholder="http://localhost:8992"
              className="cp-input sm:col-span-2"
            />
          </Field>
        </div>

        <div className="mt-4">
          <PrimaryButton
            disabled={provisioning || !token.trim() || !account.trim() || !hostname.trim()}
            onClick={runProvision}
          >
            {provisioning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {provisioning ? 'Provisioning…' : 'Provision tunnel'}
          </PrimaryButton>
        </div>

        {provision ? <ProvisionPanel result={provision} /> : null}
      </Section>

      <FooterRow
        left={<SecondaryButton onClick={onBack}>Back</SecondaryButton>}
        right={
          <div className="flex gap-2">
            <SecondaryButton onClick={onNext} disabled={saving}>
              Skip
            </SecondaryButton>
            <PrimaryButton disabled={saving} onClick={saveCredsAndNext}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save creds &amp; continue <ChevronRight className="h-4 w-4" />
            </PrimaryButton>
          </div>
        }
      />
    </div>
  );
}

function ProvisionPanel({ result }: { result: ProvisionResult }) {
  if (!result.ok) {
    return (
      <Notice tone="err">
        <strong>Provision failed:</strong> {result.message}
      </Notice>
    );
  }
  return (
    <div className="mt-4 space-y-3 rounded-md border border-neon-green/40 bg-neon-green/5 p-4 text-sm">
      <div className="flex items-start gap-2 text-neon-green">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{result.message}</span>
      </div>
      {result.tunnelToken ? (
        <>
          <p className="text-xs text-foreground-muted">
            Now install the connector on this server. Pick whichever fits your environment:
          </p>
          {result.dockerCmd ? <CommandBlock label="docker" command={result.dockerCmd} /> : null}
          {result.debianCmd ? <CommandBlock label="systemd (cloudflared package)" command={result.debianCmd} /> : null}
          {result.windowsCmd ? <CommandBlock label="windows (cloudflared.exe)" command={result.windowsCmd} /> : null}
          <p className="text-[11px] text-foreground-subtle">
            Once the connector is running, <code>{result.hostname}</code> will resolve to this
            machine via Cloudflare. The connector token is also shown in your Cloudflare
            dashboard if you need it again.
          </p>
        </>
      ) : (
        <p className="text-xs text-foreground-muted">
          Tunnel updated, but Cloudflare did not return a connector token (this happens for
          tunnels with existing active connectors). Re-issue the token from the Cloudflare
          dashboard under Networks → Tunnels → your tunnel → Configure.
        </p>
      )}
    </div>
  );
}

function CommandBlock({ label, command }: { label: string; command: string }) {
  const [copied, setCopied] = React.useState(false);
  function copy() {
    navigator.clipboard.writeText(command).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase tracking-wider text-foreground-subtle">{label}</div>
      <div className="flex items-start gap-2 rounded-md border border-border bg-background-elevated p-3">
        <code className="flex-1 break-all font-mono text-xs text-foreground">{command}</code>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-foreground-muted hover:text-foreground"
        >
          {copied ? <CheckCircle2 className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Docker auto-fix block — surfaced when the validator can't reach the socket
// ----------------------------------------------------------------------------

function AutoFixDocker({
  stage,
  socketGid,
  oneliner,
  onRetest,
}: {
  stage: 'permission-denied' | 'socket-missing';
  socketGid?: number;
  oneliner?: string;
  onRetest: () => void;
}) {
  return (
    <div className="mt-3 rounded-md border border-neon-magenta/40 bg-neon-magenta/5 p-3 text-xs">
      <div className="flex items-center gap-2 text-neon-magenta">
        <Sparkles className="h-3.5 w-3.5" />
        <strong>The wizard can fix this for you.</strong>
      </div>
      <p className="mt-2 text-foreground-muted">
        {stage === 'permission-denied' ? (
          <>
            The docker socket on your host is owned by GID{' '}
            <code>{String(socketGid ?? '?')}</code>. Run the one-liner below on the host — it
            backs up <code>docker-compose.yml</code>, adds that GID to <code>group_add</code>{' '}
            (idempotent), and recreates the cachepanel container.
          </>
        ) : (
          <>
            The docker socket isn&apos;t mounted into the container. Run the one-liner below on
            the host — it adds the bind mount + group, then recreates the cachepanel container.
          </>
        )}
      </p>
      {oneliner ? <CommandBlock label="run on the host" command={oneliner} /> : null}
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={onRetest}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-foreground-muted hover:text-foreground"
        >
          <TestTube className="h-3 w-3" />
          Re-test after running
        </button>
        <span className="text-[11px] text-foreground-subtle">
          (The container will restart — give it ~10s, then re-test.)
        </span>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Ollama
// ----------------------------------------------------------------------------

function OllamaStep({
  draft,
  saving,
  onSave,
  onBack,
  onNext,
}: {
  draft: Initial;
  saving: boolean;
  onSave: (patch: Partial<Initial>) => Promise<boolean>;
  onBack: () => void;
  onNext: () => void;
}) {
  const [host, setHost] = React.useState(draft.ollama_host || 'http://host.docker.internal:11434');
  const [model, setModel] = React.useState(draft.ollama_model || 'mistral');
  const [test, setTest] = React.useState<TestResult | null>(null);
  const [testing, setTesting] = React.useState(false);

  async function runTest() {
    setTesting(true);
    setTest(null);
    try {
      const res = await fetch('/api/setup/validate/ollama', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: host.trim(), model: model.trim() }),
      });
      setTest(await res.json());
    } catch (err) {
      setTest({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setTesting(false);
    }
  }

  async function saveAndNext() {
    const ok = await onSave({ ollama_host: host.trim(), ollama_model: model.trim() });
    if (ok) onNext();
  }

  const available = (test?.availableModels as string[] | undefined) ?? [];

  return (
    <div>
      <StepHeader
        title="AI assistant (Ollama, optional)"
        subtitle="Enables the in-panel chat assistant. Skip if you don't run Ollama."
      />

      <div className="mt-5 space-y-3">
        <Field label="Ollama host URL" hint="If Ollama runs on the host machine and CachePanel is in Docker, use http://host.docker.internal:11434 (Linux requires extra_hosts in docker-compose).">
          <input
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="http://host.docker.internal:11434"
            className="cp-input"
          />
        </Field>
        <Field label="Default model">
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="mistral"
            className="cp-input"
          />
          {available.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {available.slice(0, 12).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setModel(m)}
                  className="rounded-full border border-border bg-background-elevated px-2 py-0.5 text-[11px] text-foreground-muted hover:border-neon-green/40 hover:text-foreground"
                >
                  {m}
                </button>
              ))}
              {available.length > 12 ? (
                <span className="text-[11px] text-foreground-subtle">+{available.length - 12} more</span>
              ) : null}
            </div>
          ) : null}
        </Field>
      </div>

      <TestRow
        canTest={Boolean(host.trim())}
        testing={testing}
        onTest={runTest}
        result={test}
      />

      <FooterRow
        left={<SecondaryButton onClick={onBack}>Back</SecondaryButton>}
        right={
          <div className="flex gap-2">
            <SecondaryButton onClick={onNext} disabled={saving}>
              Skip
            </SecondaryButton>
            <PrimaryButton disabled={saving} onClick={saveAndNext}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save &amp; continue <ChevronRight className="h-4 w-4" />
            </PrimaryButton>
          </div>
        }
      />
    </div>
  );
}

// ----------------------------------------------------------------------------
// Finish
// ----------------------------------------------------------------------------

function FinishStep({
  draft,
  saving,
  onComplete,
  onBack,
  onJump,
}: {
  draft: Initial;
  saving: boolean;
  onComplete: () => void;
  onBack: () => void;
  onJump: (s: Step) => void;
}) {
  return (
    <div>
      <StepHeader
        title="Ready to go."
        subtitle="Review and finish — clicking Finish invalidates the setup token, then you sign in with Discord (first login becomes OWNER)."
      />

      <ul className="mt-4 space-y-2 rounded-md border border-border bg-background-elevated p-4 text-sm text-foreground-muted">
        <Summary label="Discord Client ID" value={draft.discord_client_id || '— missing —'} onEdit={() => onJump('discord')} bad={!draft.discord_client_id} />
        <Summary label="Discord Client Secret" value={draft.discord_client_secret ? '(set)' : '— missing —'} onEdit={() => onJump('discord')} bad={!draft.discord_client_secret} />
        <Summary label="Guild restriction" value={draft.discord_guild_id || '(any guild)'} onEdit={() => onJump('access')} />
        <Summary label="User allowlist" value={draft.discord_allowed_user_ids.length > 0 ? `${draft.discord_allowed_user_ids.length} user(s)` : '(anyone with Discord)'} onEdit={() => onJump('access')} />
        <Summary label="SSH-to-host" value={draft.ssh_host ? `${draft.ssh_user}@${draft.ssh_host}:${draft.ssh_port}` : '(none — terminal/scheduler disabled)'} onEdit={() => onJump('docker')} />
        <Summary label="Cloudflare API" value={draft.cloudflare_api_token ? `configured (acct ${draft.cloudflare_account_id.slice(0, 8)}…)` : '(not configured)'} onEdit={() => onJump('cloudflare')} />
        <Summary label="Ollama" value={draft.ollama_host ? `${draft.ollama_host} (${draft.ollama_model})` : '(disabled)'} onEdit={() => onJump('ollama')} />
      </ul>

      <FooterRow
        left={<SecondaryButton onClick={onBack}>Back</SecondaryButton>}
        right={
          <PrimaryButton
            onClick={onComplete}
            disabled={saving || !draft.discord_client_id || !draft.discord_client_secret}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Finish &amp; go to login
          </PrimaryButton>
        }
      />
    </div>
  );
}

// ----------------------------------------------------------------------------
// Shared widgets
// ----------------------------------------------------------------------------

function StepHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      <p className="mt-1 text-sm text-foreground-muted">{subtitle}</p>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-foreground-muted">{label}</span>
      <div className="mt-1">{children}</div>
      {hint ? <span className="mt-1 block text-[11px] text-foreground-subtle">{hint}</span> : null}
    </label>
  );
}

function Section({
  title,
  children,
  wide = false,
}: {
  title: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={`mt-5 rounded-md border border-border bg-background-elevated/40 p-4 ${wide ? '' : ''}`}>
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-foreground-subtle">
        {title}
      </div>
      {children}
    </div>
  );
}

function Tile({
  icon,
  label,
  value,
  mono = false,
  warn = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  mono?: boolean;
  warn?: boolean;
}) {
  return (
    <div
      className={`rounded-md border ${warn ? 'border-yellow-500/40 bg-yellow-500/5' : 'border-border bg-background-elevated'} p-3`}
    >
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-foreground-subtle">
        {icon}
        {label}
      </div>
      <div className={`mt-1 break-all text-sm ${mono ? 'font-mono' : ''} text-foreground`}>
        {value}
      </div>
    </div>
  );
}

function Notice({
  tone,
  children,
}: {
  tone: 'warn' | 'err' | 'info';
  children: React.ReactNode;
}) {
  const styles =
    tone === 'warn'
      ? 'border-yellow-500/40 bg-yellow-500/10 text-yellow-200'
      : tone === 'err'
        ? 'border-red-500/40 bg-red-500/10 text-red-300'
        : 'border-neon-magenta/40 bg-neon-magenta/10 text-foreground-muted';
  return <div className={`mt-3 rounded-md border ${styles} p-3 text-xs`}>{children}</div>;
}

function FooterRow({ left, right }: { left?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mt-6 flex items-center justify-between gap-2">
      <div>{left}</div>
      <div>{right}</div>
    </div>
  );
}

function TestRow({
  canTest,
  testing,
  onTest,
  result,
}: {
  canTest: boolean;
  testing: boolean;
  onTest: () => void;
  result: TestResult | null;
}) {
  return (
    <div className="mt-4">
      <button
        type="button"
        disabled={!canTest || testing}
        onClick={onTest}
        className="inline-flex items-center gap-2 rounded-md border border-neon-magenta/40 bg-neon-magenta/10 px-3 py-1.5 text-xs font-medium text-neon-magenta hover:bg-neon-magenta/20 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {testing ? <Loader2 className="h-3 w-3 animate-spin" /> : <TestTube className="h-3 w-3" />}
        {testing ? 'Testing…' : 'Test connection'}
      </button>
      {result ? (
        <div
          className={`mt-2 flex items-start gap-2 rounded-md border px-3 py-2 text-xs ${
            result.ok
              ? 'border-neon-green/40 bg-neon-green/5 text-neon-green'
              : 'border-red-500/40 bg-red-500/10 text-red-300'
          }`}
        >
          {result.ok ? (
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          ) : (
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          )}
          <span className="flex-1">{result.message}</span>
        </div>
      ) : null}
    </div>
  );
}

function Summary({
  label,
  value,
  onEdit,
  bad = false,
}: {
  label: string;
  value: string;
  onEdit?: () => void;
  bad?: boolean;
}) {
  return (
    <li className="flex items-center justify-between gap-3">
      <span className="text-foreground-subtle">{label}</span>
      <span className="flex items-center gap-2">
        <span className={`truncate font-mono text-xs ${bad ? 'text-red-300' : 'text-foreground'}`}>
          {value}
        </span>
        {onEdit ? (
          <button
            type="button"
            onClick={onEdit}
            className="text-[11px] text-foreground-subtle underline-offset-2 hover:text-foreground hover:underline"
          >
            edit
          </button>
        ) : null}
      </span>
    </li>
  );
}

function PrimaryButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-2 rounded-lg border border-neon-green/40 bg-neon-green/15 px-4 py-2 text-sm font-medium text-neon-green hover:bg-neon-green/25 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function SecondaryButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm text-foreground-muted hover:border-border-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function Style() {
  return (
    <style jsx global>{`
      .cp-input {
        width: 100%;
        border-radius: 0.375rem;
        border: 1px solid var(--cp-border);
        background: var(--cp-bg-elevated);
        padding: 0.5rem 0.75rem;
        font-size: 0.875rem;
        font-family: ui-monospace, monospace;
        color: var(--cp-fg);
      }
      .cp-input::placeholder {
        color: var(--cp-fg-subtle);
      }
      .cp-input:focus {
        outline: none;
        border-color: rgba(230, 0, 255, 0.5);
      }
    `}</style>
  );
}
