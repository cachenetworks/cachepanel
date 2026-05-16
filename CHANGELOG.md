# Changelog

All notable changes to CachePanel.

## v1.6.0 — 2026-05-16

### Added
- **10 more apps in the catalog**: Jellyfin, Plex, code-server, n8n,
  Grafana, Portainer CE, Nginx Proxy Manager, Dozzle, Watchtower, Glances.
  New categories: `media`, `devtools`, `automation`.
- **File transfer between servers.** Right-click any file/folder in the
  file manager → "Transfer to another server…". Streams via `tar | tar`
  over SSH from the primary, verifies file count, supports copy or move.
- **Docker image builder** (`/docker/build`). Inline Dockerfile editor +
  build context picker (absolute server path) OR upload a `.tar.gz`
  context from the browser (up to 500 MB). Streams the full build log
  back.
- **Server batch actions UI** (`/admin/batch`). Select servers by
  individual checkbox or by tag, run a whitelisted action (restart
  container, pull image, compose up/down, safe shell command) across
  all of them, see per-server output.
- **In-browser asciinema replay** (`/admin/recordings`). v1.5 wrote the
  cast files; v1.6 plays them back without leaving the panel. Loads the
  player via CDN to avoid bundle bloat.
- **Cloud backups (S3-compatible).** AWS S3, Cloudflare R2, Backblaze
  B2, MinIO, Wasabi — anything with an S3-compatible endpoint.
  Configure under Settings → Backups → "Configure S3". Tick "Also
  upload to <bucket>" when creating a backup.
- **Scheduled commands** (`/schedules`). Cron jobs synced into the SSH
  user's crontab on a target server, tagged so the panel only touches
  its own lines. Presets for every-minute / every-hour / daily /
  weekly / monthly + free-form crontab grammar.
- **Self-updater.** Settings → Panel updates compares the local
  container's image digest to GHCR's `:latest`, surfaces "update
  available" + a one-click apply that runs `docker compose pull &&
  up -d cachepanel` over SSH-to-self.
- **Docker volumes browser + cleaner** (`/docker/cleanup`). Lists every
  volume with its mountpoint, size, and "in use" status. Quick-prune
  buttons for unused images / volumes / networks / build cache, plus
  per-volume remove (with `--force` when in use).

### Changed
- Catalog category type extended (`media`, `devtools`, `automation`).
- Sidebar gains Recordings, Batch actions, Schedules entries.
- Docker page top-bar gains "Build image" + "Volumes &amp; cleanup" links.

### Deferred to v1.7+
- Light mode, mobile-responsive sidebar, i18n scaffolding.
- Remote SQL console with editor + history + CSV export.
- Container template builder (overlaps with the app catalog; will be
  extended catalog tooling rather than a separate UI).
- Resource quotas per user.
- Streaming build logs (the v1.6 builder returns the full log at end).

---

## v1.5.0 — 2026-05-16

### Added
- **Discord webhook alerts.** Panel-wide webhook URL + per-event toggles
  under Settings. Events: `login.success`, `user.approved`,
  `user.role_changed`, `mfa.enrolled/removed`, `container.died`,
  `disk.high`, `server.unreachable/recovered`, `app.installed/uninstalled`.
- **WebAuthn 2FA.** Optional second factor on top of Discord OAuth.
  Hardware keys, Touch ID, Windows Hello. Recovery codes printed once at
  enrollment. Sensitive writes require a valid MFA cookie after enrollment.
  Disabled gracefully on plain-HTTP installs (HTTPS required).
- **One-click app installs.** Catalog with Vaultwarden, Uptime Kuma,
  FileBrowser, Pi-hole. `/apps` lists installed; `/apps/catalog` is the
  storefront. Renders docker-compose templates per server with
  port-conflict preflight.
- **Per-server health page.** Inline-SVG sparkline charts (no recharts
  dependency) for memory %, disk %, load average, reachability — over
  1h / 6h / 24h / 7d ranges. Snapshots persisted by the alert poller
  every 60s, pruned after 7 days.
- **Audit log filters.** Date range pickers + the existing action filter;
  CSV export honors the filters.
- **Live tail in the file manager.** Right-click any `.log`/`.txt`/`.out`/`.err`
  file → Live tail. Pauses, clears, auto-scrolls, detects rotation.
- **SSH session recording (asciinema v2).** Every browser-terminal
  session is written to `/app/data/recordings/<sessionId>.cast`.
  Download via `/api/recordings`, replay locally with `asciinema play`.
  (In-browser replay UI lands in v1.6.)
- **Backups.** `Settings → Backups` button creates a `tar.gz` snapshot
  of `/app/data` (DB + secrets), listed with download/delete. Local-only
  in v1.5; S3/B2 lands in v1.6.
- **Server batch actions API.** `POST /api/servers/batch` runs a
  whitelisted action across servers selected by ID or tag. MFA-gated.
  (UI lands in v1.6.)
- **Multi-distro installer.** `install.sh` now supports openSUSE (zypper),
  Alpine (apk + static cloudflared binary), Mint / Pop!_OS / Zorin
  (proper codename detection), NixOS (graceful escape with
  configuration.nix snippet), and immutable-root distros
  (MicroOS / Aeon / Kalpa).
- **GPU detection fallback** via `/sys/class/drm` PCI vendor IDs for
  hosts without `nvidia-smi` or `lspci` (Alpine base, minimal Pi OS).
- **Pterodactyl egg** at `/cachepanel.egg.json`. Installs CachePanel
  directly inside the yolk container — no DinD required.

### Changed
- `Button` variant `secondary` removed in favor of `outline` (was never
  defined; just hadn't broken at runtime). Five call sites migrated.
- `.gitignore` `data/` anchored to `/data/` so `src/data/` is tracked.
- README — corrected DB claim (panel uses SQLite, not Postgres).
- License — proprietary terms; contact via Discord `cache_og`.

### Fixed
- LMDE codename bug — LMDE 6 (`faye`) now resolves to `bookworm` for
  the Docker apt repo. Same fix applies to the Cloudflare apt repo.
- WebAuthn type imports moved between `@simplewebauthn/server` subpaths
  across minor versions — inferred from function signatures instead.

### Deferred to v1.6
- First-run setup wizard (needs auth-bypass refactor).
- Server batch UI (API is in v1.5).
- Cloud backup destinations (S3/B2).
- In-browser asciinema replay player.
- Light mode, mobile-responsive sidebar, i18n scaffolding.
- Remote SQL console.
- Container template builder.
- Resource quotas.
- Scheduled commands.
