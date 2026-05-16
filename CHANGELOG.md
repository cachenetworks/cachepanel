# Changelog

All notable changes to CachePanel.

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
