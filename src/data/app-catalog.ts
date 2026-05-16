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
  category: 'security' | 'monitoring' | 'utilities' | 'networking' | 'media' | 'devtools' | 'automation';
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

// ============================================================================
// v1.6 — 10 new apps
// ============================================================================

const JELLYFIN: CatalogApp = {
  slug: 'jellyfin',
  name: 'Jellyfin',
  description:
    'Open-source media server — movies, TV, music, photos. Browser, mobile, smart-TV clients. No subscriptions.',
  icon: '/apps-icons/jellyfin.svg',
  category: 'media',
  defaultPort: 8096,
  latestImage: 'jellyfin/jellyfin:latest',
  links: { docs: 'https://jellyfin.org/docs/', github: 'https://github.com/jellyfin/jellyfin' },
  variables: [
    { name: 'PORT', label: 'Web UI port', type: 'port', default: '8096', required: true },
    {
      name: 'MEDIA_PATH',
      label: 'Media library path (host)',
      type: 'string',
      default: '/srv/media',
      required: true,
      description: 'Absolute host path containing your movies/tv directories.',
    },
  ],
  composeTemplate: `services:
  jellyfin:
    image: jellyfin/jellyfin:latest
    container_name: cachepanel-jellyfin
    restart: unless-stopped
    network_mode: bridge
    ports:
      - "{{PORT}}:8096"
    volumes:
      - ./data/config:/config
      - ./data/cache:/cache
      - "{{MEDIA_PATH}}:/media:ro"
`,
};

const PLEX: CatalogApp = {
  slug: 'plex',
  name: 'Plex Media Server',
  description:
    'Polished media server with cloud sync, mobile sync, and live TV. Requires a free plex.tv account.',
  icon: '/apps-icons/plex.svg',
  category: 'media',
  defaultPort: 32400,
  latestImage: 'plexinc/pms-docker:latest',
  links: { docs: 'https://support.plex.tv', github: 'https://github.com/plexinc/pms-docker' },
  variables: [
    { name: 'PORT', label: 'Web UI port', type: 'port', default: '32400', required: true },
    {
      name: 'PLEX_CLAIM',
      label: 'Plex claim token',
      type: 'password',
      secret: true,
      description: 'Get one at plex.tv/claim — only valid for ~4 minutes. Required on first boot.',
    },
    {
      name: 'MEDIA_PATH',
      label: 'Media library path (host)',
      type: 'string',
      default: '/srv/media',
      required: true,
    },
  ],
  composeTemplate: `services:
  plex:
    image: plexinc/pms-docker:latest
    container_name: cachepanel-plex
    restart: unless-stopped
    environment:
      PLEX_CLAIM: "{{PLEX_CLAIM}}"
      TZ: "UTC"
    ports:
      - "{{PORT}}:32400"
    volumes:
      - ./data/config:/config
      - ./data/transcode:/transcode
      - "{{MEDIA_PATH}}:/data:ro"
`,
};

const CODE_SERVER: CatalogApp = {
  slug: 'code-server',
  name: 'code-server (VS Code)',
  description: 'Run VS Code in the browser. Full editor with extensions. Great for cloud dev boxes.',
  icon: '/apps-icons/code-server.svg',
  category: 'devtools',
  defaultPort: 8443,
  latestImage: 'codercom/code-server:latest',
  links: { docs: 'https://coder.com/docs/code-server', github: 'https://github.com/coder/code-server' },
  variables: [
    { name: 'PORT', label: 'Web UI port', type: 'port', default: '8443', required: true },
    {
      name: 'PASSWORD',
      label: 'Login password',
      type: 'password',
      secret: true,
      required: true,
    },
    {
      name: 'WORKSPACE_PATH',
      label: 'Workspace path (host)',
      type: 'string',
      default: '/srv/code',
      required: true,
    },
  ],
  composeTemplate: `services:
  code-server:
    image: codercom/code-server:latest
    container_name: cachepanel-code-server
    restart: unless-stopped
    environment:
      PASSWORD: "{{PASSWORD}}"
    ports:
      - "{{PORT}}:8080"
    volumes:
      - ./data/config:/home/coder/.config
      - "{{WORKSPACE_PATH}}:/home/coder/project"
`,
};

const N8N: CatalogApp = {
  slug: 'n8n',
  name: 'n8n',
  description:
    'Fair-code workflow automation — 400+ integrations, visual editor, self-hosted Zapier alternative.',
  icon: '/apps-icons/n8n.svg',
  category: 'automation',
  defaultPort: 5678,
  latestImage: 'n8nio/n8n:latest',
  links: { docs: 'https://docs.n8n.io', github: 'https://github.com/n8n-io/n8n' },
  variables: [
    { name: 'PORT', label: 'Web UI port', type: 'port', default: '5678', required: true },
    {
      name: 'BASIC_AUTH_USER',
      label: 'Admin username',
      type: 'string',
      default: 'admin',
      required: true,
    },
    {
      name: 'BASIC_AUTH_PASSWORD',
      label: 'Admin password',
      type: 'password',
      secret: true,
      required: true,
    },
  ],
  composeTemplate: `services:
  n8n:
    image: n8nio/n8n:latest
    container_name: cachepanel-n8n
    restart: unless-stopped
    environment:
      N8N_BASIC_AUTH_ACTIVE: "true"
      N8N_BASIC_AUTH_USER: "{{BASIC_AUTH_USER}}"
      N8N_BASIC_AUTH_PASSWORD: "{{BASIC_AUTH_PASSWORD}}"
      N8N_HOST: "0.0.0.0"
      N8N_PORT: "5678"
    ports:
      - "{{PORT}}:5678"
    volumes:
      - ./data:/home/node/.n8n
`,
};

const GRAFANA: CatalogApp = {
  slug: 'grafana',
  name: 'Grafana',
  description: 'Dashboards for everything — Prometheus, Loki, InfluxDB, Postgres, you name it.',
  icon: '/apps-icons/grafana.svg',
  category: 'monitoring',
  defaultPort: 3000,
  latestImage: 'grafana/grafana:latest',
  links: { docs: 'https://grafana.com/docs/', github: 'https://github.com/grafana/grafana' },
  variables: [
    { name: 'PORT', label: 'Web UI port', type: 'port', default: '3000', required: true },
    {
      name: 'ADMIN_PASSWORD',
      label: 'Admin password',
      type: 'password',
      secret: true,
      required: true,
    },
  ],
  composeTemplate: `services:
  grafana:
    image: grafana/grafana:latest
    container_name: cachepanel-grafana
    restart: unless-stopped
    environment:
      GF_SECURITY_ADMIN_PASSWORD: "{{ADMIN_PASSWORD}}"
    ports:
      - "{{PORT}}:3000"
    volumes:
      - ./data:/var/lib/grafana
`,
};

const PORTAINER: CatalogApp = {
  slug: 'portainer',
  name: 'Portainer CE',
  description: 'Docker / Swarm / Kubernetes management UI. Useful as a second opinion alongside CachePanel.',
  icon: '/apps-icons/portainer.svg',
  category: 'devtools',
  defaultPort: 9000,
  latestImage: 'portainer/portainer-ce:latest',
  links: { docs: 'https://docs.portainer.io', github: 'https://github.com/portainer/portainer' },
  variables: [
    { name: 'PORT', label: 'Web UI port', type: 'port', default: '9000', required: true },
  ],
  composeTemplate: `services:
  portainer:
    image: portainer/portainer-ce:latest
    container_name: cachepanel-portainer
    restart: unless-stopped
    ports:
      - "{{PORT}}:9000"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - ./data:/data
`,
};

const NPM: CatalogApp = {
  slug: 'nginx-proxy-manager',
  name: 'Nginx Proxy Manager',
  description:
    'Reverse proxy + free Let\\'s Encrypt SSL in a clean UI. Point a domain at it, click "request cert", done.',
  icon: '/apps-icons/npm.svg',
  category: 'networking',
  defaultPort: 81,
  latestImage: 'jc21/nginx-proxy-manager:latest',
  links: { docs: 'https://nginxproxymanager.com', github: 'https://github.com/NginxProxyManager/nginx-proxy-manager' },
  variables: [
    { name: 'PORT', label: 'Admin UI port', type: 'port', default: '81', required: true },
    { name: 'HTTP_PORT', label: 'HTTP port (80)', type: 'port', default: '80', required: true },
    { name: 'HTTPS_PORT', label: 'HTTPS port (443)', type: 'port', default: '443', required: true },
  ],
  composeTemplate: `services:
  npm:
    image: jc21/nginx-proxy-manager:latest
    container_name: cachepanel-npm
    restart: unless-stopped
    ports:
      - "{{HTTP_PORT}}:80"
      - "{{HTTPS_PORT}}:443"
      - "{{PORT}}:81"
    volumes:
      - ./data:/data
      - ./letsencrypt:/etc/letsencrypt
`,
};

const DOZZLE: CatalogApp = {
  slug: 'dozzle',
  name: 'Dozzle',
  description: 'Real-time log viewer for Docker. Zero config, ~10MB image. Pairs nicely with Portainer.',
  icon: '/apps-icons/dozzle.svg',
  category: 'monitoring',
  defaultPort: 8080,
  latestImage: 'amir20/dozzle:latest',
  links: { docs: 'https://dozzle.dev', github: 'https://github.com/amir20/dozzle' },
  variables: [
    { name: 'PORT', label: 'Web UI port', type: 'port', default: '8080', required: true },
  ],
  composeTemplate: `services:
  dozzle:
    image: amir20/dozzle:latest
    container_name: cachepanel-dozzle
    restart: unless-stopped
    ports:
      - "{{PORT}}:8080"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
`,
};

const WATCHTOWER: CatalogApp = {
  slug: 'watchtower',
  name: 'Watchtower',
  description:
    'Auto-update Docker containers when new images are published. Headless — no UI.',
  icon: '/apps-icons/watchtower.svg',
  category: 'automation',
  defaultPort: 0,
  latestImage: 'containrrr/watchtower:latest',
  links: { docs: 'https://containrrr.dev/watchtower/', github: 'https://github.com/containrrr/watchtower' },
  variables: [
    {
      name: 'CHECK_INTERVAL',
      label: 'Check interval (seconds)',
      type: 'string',
      default: '86400',
      required: true,
      description: '86400 = once per day. Lower values poll registries more aggressively.',
    },
  ],
  composeTemplate: `services:
  watchtower:
    image: containrrr/watchtower:latest
    container_name: cachepanel-watchtower
    restart: unless-stopped
    environment:
      WATCHTOWER_POLL_INTERVAL: "{{CHECK_INTERVAL}}"
      WATCHTOWER_CLEANUP: "true"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
`,
};

const GLANCES: CatalogApp = {
  slug: 'glances',
  name: 'Glances',
  description: 'Cross-platform monitoring tool — CPU, memory, network, disk, processes, sensors, in a web UI.',
  icon: '/apps-icons/glances.svg',
  category: 'monitoring',
  defaultPort: 61208,
  latestImage: 'nicolargo/glances:latest-full',
  links: { docs: 'https://nicolargo.github.io/glances/', github: 'https://github.com/nicolargo/glances' },
  variables: [
    { name: 'PORT', label: 'Web UI port', type: 'port', default: '61208', required: true },
  ],
  composeTemplate: `services:
  glances:
    image: nicolargo/glances:latest-full
    container_name: cachepanel-glances
    restart: unless-stopped
    pid: host
    network_mode: bridge
    ports:
      - "{{PORT}}:61208"
    environment:
      GLANCES_OPT: "-w"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - /etc/os-release:/etc/os-release:ro
`,
};

export const APP_CATALOG: CatalogApp[] = [
  // v1.5
  VAULTWARDEN,
  UPTIME_KUMA,
  FILEBROWSER,
  PIHOLE,
  // v1.6
  JELLYFIN,
  PLEX,
  CODE_SERVER,
  N8N,
  GRAFANA,
  PORTAINER,
  NPM,
  DOZZLE,
  WATCHTOWER,
  GLANCES,
];

export function getCatalogApp(slug: string): CatalogApp | null {
  return APP_CATALOG.find((a) => a.slug === slug) ?? null;
}
