'use client';

import * as React from 'react';
import { Bell, Save, Send } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardSubtitle, CardBody } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toaster';
import { cn } from '@/lib/utils';

interface AlertSettings {
  url: string;
  enabled: Record<string, boolean>;
  availableEvents: string[];
}

const EVENT_LABELS: Record<string, { label: string; description: string }> = {
  'login.success': { label: 'New login', description: 'Someone logs into the panel.' },
  'user.approved': { label: 'User approved', description: 'A pending user is approved.' },
  'user.role_changed': { label: 'Role changed', description: 'A user is promoted or demoted.' },
  'mfa.enrolled': { label: '2FA enrolled', description: 'A user adds a security key.' },
  'mfa.removed': { label: '2FA removed', description: 'A user removes a security key.' },
  'container.died': { label: 'Container died', description: 'A container exits non-zero.' },
  'disk.high': { label: 'Disk usage high', description: 'Root disk crosses 90%.' },
  'server.unreachable': { label: 'Server unreachable', description: 'SSH fails for 5+ minutes.' },
  'server.recovered': { label: 'Server recovered', description: 'A previously unreachable server is back.' },
  'app.installed': { label: 'App installed', description: 'A one-click app is installed.' },
  'app.uninstalled': { label: 'App uninstalled', description: 'A one-click app is removed.' },
  'app.update_available': { label: 'App update available', description: 'A newer image tag is published.' },
};

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={cn(
        'relative h-6 w-11 rounded-full border transition-all',
        checked ? 'border-neon-green/40 bg-neon-green/20 shadow-neon-green' : 'border-white/15 bg-white/5',
        disabled && 'opacity-50 cursor-not-allowed',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all',
          checked ? 'left-[1.4rem] bg-neon-green' : 'left-0.5',
        )}
      />
    </button>
  );
}

export function AlertsCard({ isOwner }: { isOwner: boolean }) {
  const { toast } = useToast();
  const [data, setData] = React.useState<AlertSettings | null>(null);
  const [url, setUrl] = React.useState('');
  const [enabled, setEnabled] = React.useState<Record<string, boolean>>({});
  const [saving, setSaving] = React.useState(false);
  const [testing, setTesting] = React.useState(false);

  React.useEffect(() => {
    if (!isOwner) return;
    (async () => {
      try {
        const res = await fetch('/api/alerts/settings', { cache: 'no-store' });
        if (!res.ok) throw new Error(await res.text());
        const body = (await res.json()) as AlertSettings;
        setData(body);
        setUrl(body.url);
        setEnabled(body.enabled ?? {});
      } catch (err) {
        toast({ variant: 'error', title: 'Failed to load alert settings', description: err instanceof Error ? err.message : String(err) });
      }
    })();
  }, [toast, isOwner]);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch('/api/alerts/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, enabled }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Failed');
      toast({ variant: 'success', title: 'Alert settings saved' });
    } catch (err) {
      toast({ variant: 'error', title: 'Save failed', description: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    if (!url) {
      toast({ variant: 'error', title: 'Enter a webhook URL first' });
      return;
    }
    setTesting(true);
    try {
      const res = await fetch('/api/alerts/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Failed');
      toast({ variant: 'success', title: 'Test sent — check your Discord channel' });
    } catch (err) {
      toast({ variant: 'error', title: 'Test failed', description: err instanceof Error ? err.message : String(err) });
    } finally {
      setTesting(false);
    }
  }

  if (!isOwner) {
    return (
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Discord alerts</CardTitle>
            <CardSubtitle>OWNER-only</CardSubtitle>
          </div>
          <Bell className="h-4 w-4 text-white/30" />
        </CardHeader>
        <CardBody>
          <p className="rounded-md border border-white/10 bg-white/[0.02] p-2 text-xs text-white/50">
            Alert webhook configuration is OWNER-only.
          </p>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Discord alerts</CardTitle>
          <CardSubtitle>Send notifications to a Discord webhook</CardSubtitle>
        </div>
        <Bell className="h-4 w-4 text-neon-magenta" />
      </CardHeader>
      <CardBody>
        {!data ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-white/70">Webhook URL</label>
              <div className="flex gap-2">
                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://discord.com/api/webhooks/…"
                  className="flex-1 rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-neon-magenta/50 focus:outline-none"
                />
                <Button type="button" variant="secondary" onClick={sendTest} disabled={testing || !url}>
                  <Send className="h-3.5 w-3.5" />
                  {testing ? 'Sending…' : 'Test'}
                </Button>
              </div>
              <p className="text-[11px] text-white/40">
                Create one in Discord → Server Settings → Integrations → Webhooks.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-white/70">Events to forward</label>
              <div className="grid gap-2 sm:grid-cols-2">
                {data.availableEvents.map((event) => {
                  const meta = EVENT_LABELS[event] ?? { label: event, description: '' };
                  return (
                    <div
                      key={event}
                      className="flex items-start gap-3 rounded-md border border-white/5 bg-white/[0.02] p-2.5"
                    >
                      <Toggle
                        checked={enabled[event] === true}
                        onChange={(v) => setEnabled({ ...enabled, [event]: v })}
                      />
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-white">{meta.label}</div>
                        {meta.description ? (
                          <div className="text-[11px] text-white/40">{meta.description}</div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex justify-end pt-1">
              <Button onClick={save} disabled={saving}>
                <Save className="h-4 w-4" />
                {saving ? 'Saving…' : 'Save alert settings'}
              </Button>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
