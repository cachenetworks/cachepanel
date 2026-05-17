'use client';

import * as React from 'react';
import { Check, ChevronRight, Copy, ExternalLink, Loader2 } from 'lucide-react';

type Step = 'welcome' | 'discord' | 'optional' | 'finish';
const STEPS: Step[] = ['welcome', 'discord', 'optional', 'finish'];

interface Initial {
  discord_client_id: string;
  discord_client_secret: string;
  discord_guild_id: string;
  discord_allowed_user_ids: string[];
  cloudflare_api_token: string;
  cloudflare_account_id: string;
  ollama_host: string;
  ollama_model: string;
}

interface Props {
  initial: Initial;
  publicUrl: string;
}

export function SetupClient({ initial, publicUrl }: Props) {
  const [step, setStep] = React.useState<Step>('welcome');
  const [draft, setDraft] = React.useState<Initial>(initial);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const stepIdx = STEPS.indexOf(step);
  const redirectUrl = `${publicUrl}/api/auth/callback/discord`;

  async function save(patch: Partial<Initial>): Promise<boolean> {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/setup/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
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
    try {
      const res = await fetch('/api/setup/complete', { method: 'POST' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Complete failed');
      window.location.href = '/login';
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto mt-12 max-w-3xl px-4">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          CachePanel first-run setup
        </h1>
        <p className="mt-1 text-sm text-foreground-muted">
          A one-time wizard to wire up Discord login and a couple of optional integrations.
        </p>
      </div>

      <ol className="mb-6 flex items-center gap-2 text-xs text-foreground-subtle">
        {STEPS.map((s, i) => (
          <li key={s} className="flex items-center gap-2">
            <span
              className={
                i < stepIdx
                  ? 'flex h-6 w-6 items-center justify-center rounded-full border border-neon-green/40 bg-neon-green/10 text-neon-green'
                  : i === stepIdx
                    ? 'flex h-6 w-6 items-center justify-center rounded-full border border-neon-magenta/40 bg-neon-magenta/10 text-neon-magenta'
                    : 'flex h-6 w-6 items-center justify-center rounded-full border border-border text-foreground-subtle'
              }
            >
              {i < stepIdx ? <Check className="h-3 w-3" /> : i + 1}
            </span>
            <span className={i === stepIdx ? 'text-foreground' : ''}>{stepLabel(s)}</span>
            {i < STEPS.length - 1 ? <ChevronRight className="h-3 w-3" /> : null}
          </li>
        ))}
      </ol>

      <div className="rounded-2xl border border-border bg-background-card p-6">
        {error ? (
          <div className="mb-4 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-300">
            {error}
          </div>
        ) : null}

        {step === 'welcome' && (
          <WelcomeStep
            publicUrl={publicUrl}
            onNext={() => setStep('discord')}
          />
        )}
        {step === 'discord' && (
          <DiscordStep
            draft={draft}
            redirectUrl={redirectUrl}
            saving={saving}
            onSave={async (patch) => {
              if (await save(patch)) setStep('optional');
            }}
            onBack={() => setStep('welcome')}
          />
        )}
        {step === 'optional' && (
          <OptionalStep
            draft={draft}
            saving={saving}
            onSave={async (patch) => {
              if (await save(patch)) setStep('finish');
            }}
            onSkip={() => setStep('finish')}
            onBack={() => setStep('discord')}
          />
        )}
        {step === 'finish' && (
          <FinishStep
            draft={draft}
            saving={saving}
            onComplete={complete}
            onBack={() => setStep('optional')}
          />
        )}
      </div>
    </div>
  );
}

function stepLabel(s: Step) {
  return s === 'welcome'
    ? 'Welcome'
    : s === 'discord'
      ? 'Discord OAuth'
      : s === 'optional'
        ? 'Optional integrations'
        : 'Finish';
}

function WelcomeStep({ publicUrl, onNext }: { publicUrl: string; onNext: () => void }) {
  const looksLocal = /(^http:\/\/(localhost|127\.|10\.|192\.168\.|172\.))/.test(publicUrl);
  return (
    <div>
      <h2 className="text-lg font-semibold text-foreground">Welcome.</h2>
      <p className="mt-2 text-sm text-foreground-muted">
        This wizard saves to the database, not <code>.env</code>. You can come back and change every
        value from <strong className="text-foreground">Settings</strong> after you're signed in.
      </p>
      <div className="mt-5 rounded-md border border-border bg-background-elevated p-4">
        <div className="text-[10px] uppercase tracking-wider text-foreground-subtle">
          Detected public URL
        </div>
        <div className="mt-1 break-all font-mono text-sm text-foreground">{publicUrl}</div>
        {looksLocal ? (
          <div className="mt-3 rounded-md border border-yellow-500/40 bg-yellow-500/10 p-2 text-[11px] text-yellow-200">
            That looks like a local/LAN address. If you'll expose CachePanel publicly (e.g. via
            Cloudflare Tunnel), set <code>NEXTAUTH_URL</code> in <code>.env</code> and restart the
            container <strong>before</strong> finishing setup, otherwise Discord OAuth will redirect
            to the wrong URL.
          </div>
        ) : null}
      </div>
      <div className="mt-6 flex justify-end">
        <PrimaryButton onClick={onNext}>
          Next: Discord OAuth <ChevronRight className="h-4 w-4" />
        </PrimaryButton>
      </div>
    </div>
  );
}

function DiscordStep({
  draft,
  redirectUrl,
  saving,
  onSave,
  onBack,
}: {
  draft: Initial;
  redirectUrl: string;
  saving: boolean;
  onSave: (patch: Partial<Initial>) => Promise<void>;
  onBack: () => void;
}) {
  const [clientId, setClientId] = React.useState(draft.discord_client_id);
  const [clientSecret, setClientSecret] = React.useState(draft.discord_client_secret);
  const [copied, setCopied] = React.useState(false);

  function copy() {
    navigator.clipboard.writeText(redirectUrl).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-foreground">Discord OAuth (required)</h2>
      <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-foreground-muted">
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
          Open the <strong className="text-foreground">OAuth2</strong> tab → <strong>Redirects</strong> → add this URL exactly:
        </li>
      </ol>

      <div className="mt-3 flex items-center gap-2 rounded-md border border-border bg-background-elevated p-3">
        <code className="flex-1 break-all font-mono text-xs text-neon-green">{redirectUrl}</code>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-foreground-muted hover:text-foreground"
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-foreground-muted" start={3}>
        <li>Copy the <strong className="text-foreground">CLIENT ID</strong> from "Client information".</li>
        <li>Click <strong className="text-foreground">Reset Secret</strong> and copy the new value.</li>
      </ol>

      <div className="mt-5 space-y-3">
        <Field label="Discord Client ID">
          <input
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="long number from Client information"
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

      <div className="mt-6 flex justify-between">
        <SecondaryButton onClick={onBack}>Back</SecondaryButton>
        <PrimaryButton
          disabled={saving || !clientId || !clientSecret}
          onClick={() => onSave({ discord_client_id: clientId, discord_client_secret: clientSecret })}
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Next: optional integrations <ChevronRight className="h-4 w-4" />
        </PrimaryButton>
      </div>

      <Style />
    </div>
  );
}

function OptionalStep({
  draft,
  saving,
  onSave,
  onSkip,
  onBack,
}: {
  draft: Initial;
  saving: boolean;
  onSave: (patch: Partial<Initial>) => Promise<void>;
  onSkip: () => void;
  onBack: () => void;
}) {
  const [allowList, setAllowList] = React.useState(draft.discord_allowed_user_ids.join(', '));
  const [guildId, setGuildId] = React.useState(draft.discord_guild_id);
  const [cfToken, setCfToken] = React.useState(draft.cloudflare_api_token);
  const [cfAccount, setCfAccount] = React.useState(draft.cloudflare_account_id);
  const [ollamaHost, setOllamaHost] = React.useState(draft.ollama_host);
  const [ollamaModel, setOllamaModel] = React.useState(draft.ollama_model);

  return (
    <div>
      <h2 className="text-lg font-semibold text-foreground">Optional integrations</h2>
      <p className="mt-2 text-sm text-foreground-muted">
        Skip any of these — every one is editable later from <strong>Settings</strong>. All blank?
        Click "Skip".
      </p>

      <div className="mt-5 space-y-4">
        <Section title="Access control">
          <Field label="Discord allowlist (comma-separated user IDs)">
            <input
              value={allowList}
              onChange={(e) => setAllowList(e.target.value)}
              placeholder="123456789012345678, 987654321098765432"
              className="cp-input"
            />
          </Field>
          <Field label="Restrict to one Discord server (guild ID)">
            <input
              value={guildId}
              onChange={(e) => setGuildId(e.target.value)}
              placeholder="optional"
              className="cp-input"
            />
          </Field>
        </Section>

        <Section title="Cloudflare Tunnel API (only needed for the Tunnels page)">
          <Field label="API token (Account · Tunnel · Edit + Zone · DNS · Edit)">
            <input
              type="password"
              value={cfToken}
              onChange={(e) => setCfToken(e.target.value)}
              placeholder="optional"
              className="cp-input"
            />
          </Field>
          <Field label="Account ID">
            <input
              value={cfAccount}
              onChange={(e) => setCfAccount(e.target.value)}
              placeholder="optional"
              className="cp-input"
            />
          </Field>
        </Section>

        <Section title="AI assistant (Ollama)">
          <Field label="Ollama host URL">
            <input
              value={ollamaHost}
              onChange={(e) => setOllamaHost(e.target.value)}
              placeholder="http://host.docker.internal:11434"
              className="cp-input"
            />
          </Field>
          <Field label="Model">
            <input
              value={ollamaModel}
              onChange={(e) => setOllamaModel(e.target.value)}
              placeholder="mistral"
              className="cp-input"
            />
          </Field>
        </Section>
      </div>

      <div className="mt-6 flex justify-between">
        <SecondaryButton onClick={onBack}>Back</SecondaryButton>
        <div className="flex gap-2">
          <SecondaryButton onClick={onSkip} disabled={saving}>
            Skip all
          </SecondaryButton>
          <PrimaryButton
            disabled={saving}
            onClick={() =>
              onSave({
                discord_allowed_user_ids: allowList
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean),
                discord_guild_id: guildId,
                cloudflare_api_token: cfToken,
                cloudflare_account_id: cfAccount,
                ollama_host: ollamaHost,
                ollama_model: ollamaModel,
              })
            }
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save + continue
          </PrimaryButton>
        </div>
      </div>

      <Style />
    </div>
  );
}

function FinishStep({
  draft,
  saving,
  onComplete,
  onBack,
}: {
  draft: Initial;
  saving: boolean;
  onComplete: () => void;
  onBack: () => void;
}) {
  return (
    <div>
      <h2 className="text-lg font-semibold text-foreground">Ready to go.</h2>
      <p className="mt-2 text-sm text-foreground-muted">
        Quick review of what's saved:
      </p>
      <ul className="mt-3 space-y-1.5 rounded-md border border-border bg-background-elevated p-4 text-sm text-foreground-muted">
        <Summary label="Discord Client ID" value={draft.discord_client_id || '— missing —'} />
        <Summary label="Discord Client Secret" value={draft.discord_client_secret ? '(set)' : '— missing —'} />
        <Summary label="Allowlisted user IDs" value={draft.discord_allowed_user_ids.length > 0 ? `${draft.discord_allowed_user_ids.length} user(s)` : '(anyone with Discord can attempt login)'} />
        <Summary label="Discord guild restriction" value={draft.discord_guild_id || '(none)'} />
        <Summary label="Cloudflare Tunnel API" value={draft.cloudflare_api_token ? '(configured)' : '(not configured)'} />
        <Summary label="Ollama" value={draft.ollama_host ? `${draft.ollama_host} (${draft.ollama_model})` : '(disabled)'} />
      </ul>
      <p className="mt-4 text-xs text-foreground-subtle">
        Click "Finish" to invalidate the setup token, then sign in with Discord. The first user to
        log in becomes <strong className="text-foreground">OWNER</strong>.
      </p>
      <div className="mt-6 flex justify-between">
        <SecondaryButton onClick={onBack}>Back</SecondaryButton>
        <PrimaryButton onClick={onComplete} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Finish &amp; go to login
        </PrimaryButton>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-foreground-muted">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-background-elevated/50 p-3">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-foreground-subtle">
        {title}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <li className="flex justify-between gap-3">
      <span className="text-foreground-subtle">{label}</span>
      <span className="truncate font-mono text-foreground">{value}</span>
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
    <style jsx>{`
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
