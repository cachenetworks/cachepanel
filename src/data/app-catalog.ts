// One-click app catalog. v1 ships 4 hand-tested apps; more land in a follow-up.
//
// Each compose template uses {{VAR}} placeholders that get replaced by user
// input or auto-generated secrets at install time. The renderer in
// src/lib/app-installer.ts is intentionally simple — no nesting, no escaping,
// no Mustache. Keep the templates that way.

export type AppVarType = 'string' | 'port' | 'password' | 'domain';

export interface AppVar {
  name: string;
  label: string;
  type: AppVarType;
  default?: string;
  /** If true, hide the value once set and treat as secret. */
  secret?: boolean;
  required?: boolean;
  description?: string;
}

export interface CatalogApp {
  slug: string;
  name: string;
  description: string;
  icon: string; // /apps-icons/<slug>.svg in public/
  category: 'security' | 'monitoring' | 'utilities' | 'networking';
  composeTemplate: string;
  variables: AppVar[];
  /** The HTTP port the app's web UI listens on (matches the variable named `PORT`). */
  defaultPort: number;
  latestImage: string;
  links: { docs?: string; github?: string };
}

const VAULTWARDEN: CatalogApp = {
  slug: 'vaultwarden',
  name: 'Vaultwarden',
  description:
    'Self-hosted Bitwarden-compatible password manager. Lightweight Rust rewrite of the official server.',
  icon: '/apps-icons/vaultwarden.svg',
  category: 'security',
  defaultPort: 8222,
  latestImage: 'vaultwarden/server:latest',
  links: {
    docs: 'https://github.com/dani-garcia/vaultwarden/wiki',
    github: 'https://github.com/dani-garcia/vaultwarden',
  },
  variables: [
    {
      name: 'PORT',
      label: 'Web UI port',
      type: 'port',
      default: '8222',
      required: true,
      description: 'Port on the host that exposes the Vaultwarden web UI.',
    },
    {
      name: 'ADMIN_TOKEN',
      label: 'Admin token',
      type: 'password',
      secret: true,
      required: true,
      description: 'Token for /admin. Auto-generated; you can rotate it later in .env.',
    },
    {
      name: 'DOMAIN',
      label: 'Public domain (optional)',
      type: 'domain',
      default: '',
      description: 'Full https URL if behind Cloudflare Tunnel — e.g. https://vault.example.com',
    },
  ],
  composeTemplate: `services:
  vaultwarden:
    image: vaultwarden/server:latest
    container_name: cachepanel-vaultwarden
    restart: unless-stopped
    environment:
      ADMIN_TOKEN: "{{ADMIN_TOKEN}}"
      DOMAIN: "{{DOMAIN}}"
      SIGNUPS_ALLOWED: "true"
    ports:
      - "{{PORT}}:80"
    volumes:
      - ./data:/data
`,
};

const UPTIME_KUMA: CatalogApp = {
  slug: 'uptime-kuma',
  name: 'Uptime Kuma',
  description:
    'Self-hosted monitoring tool — checks HTTP, ping, DNS, Docker containers. Beautiful status pages.',
  icon: '/apps-icons/uptime-kuma.svg',
  category: 'monitoring',
  defaultPort: 3001,
  latestImage: 'louislam/uptime-kuma:1',
  links: {
    docs: 'https://github.com/louislam/uptime-kuma/wiki',
    github: 'https://github.com/louislam/uptime-kuma',
  },
  variables: [
    {
      name: 'PORT',
      label: 'Web UI port',
      type: 'port',
      default: '3001',
      required: true,
    },
  ],
  composeTemplate: `services:
  uptime-kuma:
    image: louislam/uptime-kuma:1
    container_name: cachepanel-uptime-kuma
    restart: unless-stopped
    ports:
      - "{{PORT}}:3001"
    volumes:
      - ./data:/app/data
`,
};

const FILEBROWSER: CatalogApp = {
  slug: 'filebrowser',
  name: 'File Browser',
  description:
    'Web-based file manager with sharing, user accounts, and a clean UI. Useful as a quick "drop folder."',
  icon: '/apps-icons/filebrowser.svg',
  category: 'utilities',
  defaultPort: 8088,
  latestImage: 'filebrowser/filebrowser:latest',
  links: {
    docs: 'https://filebrowser.org/installation',
    github: 'https://github.com/filebrowser/filebrowser',
  },
  variables: [
    {
      name: 'PORT',
      label: 'Web UI port',
      type: 'port',
      default: '8088',
      required: true,
    },
    {
      name: 'ROOT_PATH',
      label: 'Host directory to expose',
      type: 'string',
      default: '/srv',
      required: true,
      description: 'Absolute path on the host to mount as the file browser root.',
    },
  ],
  composeTemplate: `services:
  filebrowser:
    image: filebrowser/filebrowser:latest
    container_name: cachepanel-filebrowser
    restart: unless-stopped
    ports:
      - "{{PORT}}:80"
    volumes:
      - "{{ROOT_PATH}}:/srv"
      - ./data:/database
      - ./config:/config
`,
};

const PIHOLE: CatalogApp = {
  slug: 'pihole',
  name: 'Pi-hole',
  description:
    'Network-wide ad blocker with a web admin. Resolves DNS for your LAN, blocks ad domains, tracks queries.',
  icon: '/apps-icons/pihole.svg',
  category: 'networking',
  defaultPort: 8089,
  latestImage: 'pihole/pihole:latest',
  links: {
    docs: 'https://docs.pi-hole.net',
    github: 'https://github.com/pi-hole/docker-pi-hole',
  },
  variables: [
    {
      name: 'PORT',
      label: 'Admin UI port',
      type: 'port',
      default: '8089',
      required: true,
      description: 'HTTP port for the admin UI. DNS still binds to 53 separately.',
    },
    {
      name: 'WEBPASSWORD',
      label: 'Admin password',
      type: 'password',
      secret: true,
      required: true,
    },
    {
      name: 'TZ',
      label: 'Timezone',
      type: 'string',
      default: 'UTC',
      required: true,
      description: 'IANA timezone string — e.g. America/New_York, Europe/London.',
    },
  ],
  composeTemplate: `services:
  pihole:
    image: pihole/pihole:latest
    container_name: cachepanel-pihole
    restart: unless-stopped
    environment:
      TZ: "{{TZ}}"
      WEBPASSWORD: "{{WEBPASSWORD}}"
    ports:
      - "53:53/tcp"
      - "53:53/udp"
      - "{{PORT}}:80/tcp"
    volumes:
      - ./data/etc-pihole:/etc/pihole
      - ./data/etc-dnsmasq.d:/etc/dnsmasq.d
    cap_add:
      - NET_ADMIN
`,
};

export const APP_CATALOG: CatalogApp[] = [VAULTWARDEN, UPTIME_KUMA, FILEBROWSER, PIHOLE];

export function getCatalogApp(slug: string): CatalogApp | null {
  return APP_CATALOG.find((a) => a.slug === slug) ?? null;
}
