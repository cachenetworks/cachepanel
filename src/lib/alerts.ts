import { getSetting, setSetting } from './settings';
import { getEnv } from './env';

export type AlertEvent =
  | 'login.success'
  | 'user.approved'
  | 'user.role_changed'
  | 'mfa.enrolled'
  | 'mfa.removed'
  | 'container.died'
  | 'disk.high'
  | 'server.unreachable'
  | 'server.recovered'
  | 'app.installed'
  | 'app.uninstalled'
  | 'app.update_available'
  | 'test';

type Tone = 'good' | 'bad' | 'warn' | 'info';

const TONE_COLOR: Record<Tone, number> = {
  good: 0x2ed573,
  bad: 0xff3860,
  warn: 0xffd166,
  info: 0xb388ff,
};

const EVENT_TONE: Record<AlertEvent, Tone> = {
  'login.success': 'info',
  'user.approved': 'good',
  'user.role_changed': 'info',
  'mfa.enrolled': 'good',
  'mfa.removed': 'warn',
  'container.died': 'bad',
  'disk.high': 'warn',
  'server.unreachable': 'bad',
  'server.recovered': 'good',
  'app.installed': 'good',
  'app.uninstalled': 'info',
  'app.update_available': 'info',
  test: 'info',
};

const EVENT_TITLE: Record<AlertEvent, string> = {
  'login.success': 'New login',
  'user.approved': 'User approved',
  'user.role_changed': 'Role changed',
  'mfa.enrolled': '2FA key enrolled',
  'mfa.removed': '2FA key removed',
  'container.died': 'Container died',
  'disk.high': 'Disk usage high',
  'server.unreachable': 'Server unreachable',
  'server.recovered': 'Server back online',
  'app.installed': 'App installed',
  'app.uninstalled': 'App uninstalled',
  'app.update_available': 'App update available',
  test: 'Test alert from CachePanel',
};

export interface AlertPayload {
  title?: string;
  description?: string;
  serverName?: string;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  url?: string;
}

// Token bucket per webhook URL — 20 messages / 60s (Discord's hard limit is 30).
const buckets = new Map<string, { tokens: number; refilledAt: number }>();
const BUCKET_MAX = 20;
const BUCKET_REFILL_MS = 60_000;

function takeToken(url: string): boolean {
  const now = Date.now();
  const b = buckets.get(url);
  if (!b) {
    buckets.set(url, { tokens: BUCKET_MAX - 1, refilledAt: now });
    return true;
  }
  if (now - b.refilledAt >= BUCKET_REFILL_MS) {
    b.tokens = BUCKET_MAX;
    b.refilledAt = now;
  }
  if (b.tokens <= 0) return false;
  b.tokens -= 1;
  return true;
}

export async function getAlertSettings() {
  const url = await getSetting('alerts.discord_webhook_url');
  const enabledRaw = await getSetting('alerts.enabled_events');
  let enabled: Partial<Record<AlertEvent, boolean>> = {};
  if (enabledRaw) {
    try {
      enabled = JSON.parse(enabledRaw);
    } catch {
      enabled = {};
    }
  }
  return { url: url ?? '', enabled };
}

export async function setAlertSettings(opts: {
  url?: string;
  enabled?: Partial<Record<AlertEvent, boolean>>;
}) {
  if (opts.url !== undefined) await setSetting('alerts.discord_webhook_url', opts.url);
  if (opts.enabled !== undefined)
    await setSetting('alerts.enabled_events', JSON.stringify(opts.enabled));
}

function buildEmbed(event: AlertEvent, payload: AlertPayload) {
  const env = getEnv();
  const fields = payload.fields ? [...payload.fields] : [];
  if (payload.serverName) {
    fields.unshift({ name: 'Server', value: payload.serverName, inline: true });
  }
  fields.push({ name: 'Event', value: event, inline: true });

  return {
    username: 'CachePanel',
    embeds: [
      {
        title: payload.title ?? EVENT_TITLE[event],
        description: payload.description ?? undefined,
        color: TONE_COLOR[EVENT_TONE[event]],
        fields,
        timestamp: new Date().toISOString(),
        url: payload.url ?? env.NEXTAUTH_URL,
        footer: { text: 'CachePanel' },
      },
    ],
  };
}

export async function emitAlert(
  event: AlertEvent,
  payload: AlertPayload = {},
  options: { force?: boolean } = {},
) {
  try {
    const { url, enabled } = await getAlertSettings();
    if (!url) return;
    if (!options.force && event !== 'test' && enabled[event] !== true) return;
    if (!takeToken(url)) {
      console.warn('[alerts] rate-limited, dropping event', event);
      return;
    }

    const body = JSON.stringify(buildEmbed(event, payload));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        signal: controller.signal,
      });
      if (!res.ok) {
        console.error(`[alerts] discord webhook returned ${res.status}: ${await res.text()}`);
      }
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    console.error('[alerts] emit failed', err);
  }
}

export async function sendTestAlert(url: string) {
  // Bypasses settings — used by the "Send test" button before saving.
  if (!url) throw new Error('webhook url required');
  const body = JSON.stringify(
    buildEmbed('test', {
      description: 'If you can read this, your webhook is wired up correctly. 🎉',
    }),
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`discord returned ${res.status}: ${text.slice(0, 200)}`);
    }
  } finally {
    clearTimeout(timer);
  }
}
