# Changelog

All notable changes to CachePanel.

## v1.8.0 — 2026-06-03

**Windows support — both as a managed host AND as the panel's own host.**

Previously every managed server had to be Linux: file ops used `stat -c`,
`find -printf`, `crontab`; user provisioning shelled to `useradd`; the
local Docker daemon was hardcoded to `/var/run/docker.sock`; the
installer was bash-only. This release adds full Windows support without
changing any behaviour for existing Linux installs.

### Added — Windows as a managed host
- **`RemoteHostAdapter` interface** in `src/lib/host-adapter.ts` with
  one method per command family (listDir, stat, readBytes, writeBytes,
  mkdir, remove, move, scheduled-jobs ops, user provisioning, snapshot,
  GPU, Docker socket, escape-hatch). The rest of the codebase routes
  through `getAdapter(server)` so it doesn't care which OS the target
  runs.
- **`adapters/linux.ts`** wraps the historical POSIX commands — same
  byte-for-byte behaviour for existing installs.
- **`adapters/windows.ts`** — PowerShell-based implementations. Prefers
  `pwsh`, falls back to `powershell.exe`. Uses `-EncodedCommand` so
  quoting never has to survive the SSH shell layer twice. Output is
  JSON via `ConvertTo-Json` so the panel parses one shape regardless of OS.
- **`Server.os` + `Server.shellPath` columns** (Prisma migration
  `20260603000000_server_os`). `os` is `linux` | `windows` | `unknown`,
  populated by `detectOs()` running `uname || ver` on first connect.
- **Add-Server wizard OS picker** — Auto-detect (default), Linux, or
  Windows. Auto-detect runs the probe during finalize. Windows-selected
  path swaps field labels and hints at OpenSSH Server install.
- **Per-host Docker-check Windows branch** — `probeRemoteDockerWindows`
  runs `docker version --format` via PowerShell `-EncodedCommand`,
  classifies failures into `no-docker` / `permission-denied` /
  `no-socket` and emits Windows-flavoured fix hints
  (`Add-LocalGroupMember -Group docker-users`, `winget install Docker.DockerDesktop`).
- **Scheduled jobs on Windows** translate to Task Scheduler entries
  under `\\CachePanel\\<tag>` via `Register-ScheduledTask`. Common cron
  patterns (`*/N * * * *`, `M H * * *`) map to native triggers; exotic
  expressions fall back to a 1-minute polling trigger.
- **Per-user provisioning Windows branch** — `New-LocalUser`,
  `Add-LocalGroupMember docker-users`, ACL-tightened
  `authorized_keys` under `C:\Users\<user>\.ssh\`.
- **System probe Windows variant** — `Get-CimInstance Win32_OperatingSystem`
  / `Win32_LogicalDisk` / `Win32_Processor` / `Win32_VideoController`
  for CPU/RAM/disk/GPU in one round trip.
- **Browser terminal on Windows hosts** — server.js detects
  `useSpec.os === 'windows'` and appends `pwsh / powershell.exe` to the
  SSH command so the user gets PowerShell instead of cmd.exe.

### Added — Windows as the panel's own host
- **`src/lib/paths.ts`** — `getDataDir()` / `getSecretsDir()` /
  `getRuntimeSecretsDir()` / `getPerUserSecretsDir()` / `getLogsDir()`.
  Linux container defaults to `/app/data`, `/run/secrets`; Windows
  defaults to `%PROGRAMDATA%\CachePanel\…`.
- **`src/lib/file-perms.ts`** — `ownerOnly()` /  `ownerOnlyDir()`
  abstracting POSIX modes vs. `icacls.exe`.
- **Windows-aware sensitive-file blocklist** in `fs-guard.ts` —
  `C:\Windows\System32\config`, `C:\Windows\NTDS`, registry hive names
  (`SAM`, `SYSTEM`, `SECURITY`, `ntds.dit`). Case-insensitive match.
- **`docker-api.ts` named-pipe branch** — when the panel itself runs on
  Windows, `SOCKET_PATH` defaults to `\\.\pipe\docker_engine`. Node's
  `http.request({ socketPath })` accepts named pipes natively, so no
  other changes needed.
- **`install-cachepanel.ps1`** — native Windows installer that:
  installs Node.js LTS + OpenSSH Server + Docker Desktop (all via
  winget), creates `C:\ProgramData\CachePanel\…` with locked ACLs,
  downloads the latest release zip, writes a 6-line `.env`, and
  registers a `CachePanel` Windows Service via NSSM (Scheduled Task
  fallback).
- **`/api/setup/fix-docker?fmt=ps1`** — PowerShell variant of the
  Docker auto-fix script. Installs Docker Desktop, adds the current
  user to `docker-users`, restarts the CachePanel Service.
- **Self-updater Windows branch** — `applyUpdate()` on `win32` spawns
  detached PowerShell that downloads the new release zip, stops the
  Service, expands, runs `npm install` + `prisma migrate deploy`,
  starts the Service again.
- **Cloudflare-tunnel Windows command** — provisioner now returns
  `windowsCmd` (`cloudflared.exe service install <token>`) alongside
  `dockerCmd` and `debianCmd`.

### Changed
- `runOnHostStdin` moved from `host-fs.ts` to `host-probe.ts` so both
  adapter modules can share it without circular deps.
- `docker-remote.ts` now swaps single quotes for double quotes on
  Windows-targeted commands (cmd.exe interprets single-quoted args
  literally; double quotes work on both shells).
- `host-fs.ts` `usingHost()` retained from v1.7.6, every helper now
  routes through `getAdapter(server)` instead of inlining commands.

### Notes
- Existing Linux installs are unaffected — the `os` column defaults
  to `unknown`, which the adapter dispatcher treats as Linux. The
  next user-initiated probe flips it to `linux`.
- Full Windows-host parity for some advanced cases (NVIDIA GPU live
  stats, complex cron expressions, one-click apps with bind mounts
  that assume POSIX paths) is best-effort in this release; tracking
  follow-ups in v1.8.1+.

## v1.7.7 — 2026-06-02

### Added
- **Find / Find+Replace in the file-manager text editor.** Ctrl+F opens
  the find bar, Ctrl+H opens replace, Enter / Shift+Enter (or F3 /
  Shift+F3) jumps next/prev, Esc closes. Toggles for case-sensitive
  and regex; live match count (`3/47`); Replace + Replace All; invalid
  regex shows an inline error instead of breaking the editor. Browser
  Ctrl+F is intercepted while the textarea has focus because it
  can't see inside `<textarea>` content.

## v1.7.6 — 2026-06-01 (hotfix)

The CONTAINER badge stuck on the Files page when a primary Server row
existed but no SSH_HOST env var was set — i.e. every v1.7+ install
that used the wizard. File manager silently rendered the panel's own
container fs instead of the host even though SSH was wired up.

### Fixed
- `usingHost()` was still doing `process.env.SSH_HOST && SSH_USER` to
  decide whether to route through SSH or local fs. Same env-only-check
  bug class as `ensurePrimaryServer()` — now async, checks
  `prisma.server.count() > 0` with a 3s cache, falls back to the env
  check only when the DB is unreachable.
- All callers (`hostListDir`, `hostStat`, `hostReadText`,
  `hostWriteText`, `hostDelete`, `hostRename`, `hostCreate`,
  `hostUploadBuffer`) + the `source` field on `/api/files/list`
  responses updated to await it.
- `ensurePrimaryServer` and both `/api/servers` create paths now
  invalidate the `usingHost` cache after writing a row, so the next
  request flips from container → host immediately.

## v1.7.5 — 2026-06-01

The Add-Server dialog now checks Docker on the new host as part of the
finalize probe and offers a copy-paste fix in the success step. So
"add a managed server" and "make Docker reachable on it" are one flow,
matching the wizard's local-Docker auto-fix UX.

### Added
- `/api/servers/finalize` POST now runs a one-round-trip remote probe
  for `/var/run/docker.sock` + `docker version`, classifies failures
  into `no-socket` / `permission-denied` / `no-docker` / `unknown`,
  and returns a `dockerCheck` blob with a pre-built fix-hint command
  for each.
- New `/api/servers/finalize?serverId=…` GET to re-run the same
  remote Docker probe without re-creating the server — used by Step 3
  of the Add-Server wizard's "Re-test" button.
- Add-Server wizard's Step 3 (success screen) now renders a
  Docker-check panel: green pass message OR a yellow notice with
  the exact `usermod -aG docker <user>` / `get.docker.com` command
  pre-filled for the host, plus a Re-test button.

### Notes
- Docker failure no longer blocks server creation. The server is saved
  either way — users can still SSH-only-manage non-docker hosts, and
  the Docker check can be re-run from the Add-Server flow or any
  future Docker page action.

## v1.7.4 — 2026-06-01

Tiny but high-impact: filling in the wizard's SSH-to-host fields now
auto-registers the install host as the panel's primary managed server,
so the server picker isn't empty when you first sign in.

### Fixed
- `ensurePrimaryServer()` was still reading `SSH_HOST`/`SSH_USER` straight
  from `process.env`, which silently broke when v1.7 moved those into
  AppSetting. It now reads via `getConfig` with env-var fallback for
  legacy installs.

### Added
- `/api/setup/complete` calls `ensurePrimaryServer()` right before
  invalidating the setup token, so the host the wizard's user just
  configured shows up under `/servers` on the very first page load
  after sign-in.
- Wizard's SSH-to-host section explains the auto-register behaviour and
  hints at `host.docker.internal` for the same-box case.

## v1.7.3 — 2026-06-01

Two big wins for first-run friction: the wizard now offers a one-command
fix when the Docker socket is unreachable, and the file manager surfaces
every container's volumes as virtual roots so users can browse named
volumes (under `/var/lib/docker/volumes/`) and bind mounts without
hand-editing `ALLOWED_FILE_ROOTS`.

### Added
- **Docker auto-fix endpoint** at `/api/setup/fix-docker` returns a
  signed bash script that detects the host docker GID, backs up
  `/opt/cachepanel/docker-compose.yml`, idempotently adds the GID to
  `group_add` (creating the block if missing), adds the
  `/var/run/docker.sock` bind mount if missing, and recreates the
  cachepanel container. The setup wizard shows this as a copy-paste
  one-liner whenever the docker test reports `permission-denied` or
  `socket-missing`.
- **Container volumes in file manager.** `/api/files/list` returns
  one virtual root per (container × mount) in the landing view. Each
  shortcut shows the container name, in-container destination path,
  and the volume name (for named volumes) or `bind`/`volume` badge.
  `/api/files/docker-roots` exposes the same data for sidebars.
- **Auto-allowlist of docker volume host paths.** New
  `resolveSafePathWithDocker` helper used by every files endpoint
  expands the allowed-roots list with paths surfaced by
  `listDockerRoots()`, so reading/writing inside container volumes
  works without permanently widening `ALLOWED_FILE_ROOTS`. Sensitive-
  file blocklist still applies.

### Changed
- `listContainers()` now returns each container's `mounts[]` array
  (type, source, destination, volume name, read-only flag).
- Setup-wizard `AutoFixDocker` block replaces the previous static
  "Quick fix" instructions with the live one-liner + re-test button.

## v1.7.2 — 2026-05-17

Rebuilt the first-run setup wizard around real validation. Every section
that touches an external service now has a "Test connection" button that
hits the service for real and reports back, so misconfigurations surface
during setup instead of at first sign-in.

### Added
- **6-step wizard** (Welcome → Discord → Access → Docker → Cloudflare →
  Ollama → Finish) replacing the previous 4-step flow. Sections are
  individually saveable + skippable.
- **Discord OAuth validator** — runs the client_credentials grant against
  Discord's token endpoint, surfaces the two most common copy/paste
  mistakes (Bot Token mistaken for Secret, stale Secret after Reset).
- **Cloudflare credentials validator** — verifies token via
  `/user/tokens/verify`, confirms account access, probes Tunnel + DNS
  scopes, returns the account name on success.
- **Docker socket validator** — distinguishes "not mounted" from
  "permission denied" and tells the user the exact compose change
  (group_add GID) needed for each.
- **Ollama validator** — confirms reachability + lists installed models,
  with a one-click model picker chip row.
- **Cloudflare tunnel auto-provisioner** — paste API token + hostname,
  and the wizard creates (or reuses) the tunnel, sets ingress, upserts
  the proxied CNAME, and hands back the connector token plus the
  docker/systemd install command.
- **Welcome context probe** (`/api/setup/context`) — shows the detected
  public URL, Discord callback URL, platform, docker-socket presence,
  and lists network interfaces.
- **Edit-from-Finish step** — review screen shows every value with a
  one-click jump back to the section that owns it.
- **SSH-to-host + terminal config now in wizard** instead of needing
  manual `/settings` editing post-install.

### Changed
- `src/lib/cloudflare.ts` reads credentials from `AppSetting` first
  (with env fallback) so wizard-saved creds work immediately, without
  a container restart. `isCloudflareConfigured()` is now async.
- `/api/setup/save` allowlist extended with `ssh_host`, `ssh_port`,
  `ssh_user`, `ssh_key_path`, `terminal_enabled`, `terminal_shell`,
  `terminal_user`.

## v1.7.1 — 2026-05-17 (hotfix)

Two follow-on bugs from the v1.7.0 config-in-DB rollout that prevented
fresh installs from completing sign-in.

### Fixed
- `/setup` page crashed with `Cookies can only be modified in a Server
  Action or Route Handler` after the user pasted the setup-token URL.
  Cookie write moved out of the Server Component into a new
  `/api/setup/claim` route handler. Bonus: setup token no longer
  lingers in the address bar after exchange.
- **Discord sign-in failed with `OAuthSignin` even after the wizard
  saved valid creds.** NextAuth options were cached at module load, so
  the constructed `DiscordProvider` held the empty pre-setup
  `clientId`/`clientSecret` forever. Auth options + the NextAuth
  handler are now rebuilt per-request, after priming the config
  snapshot, so the provider always sees the latest creds.
- **Cloudflare-Tunnel-fronted setup URL redirected to `http://0.0.0.0`.**
  `/api/setup/claim` was using `req.url` as the redirect base, which
  Cloudflare forwards as `127.0.0.1:8992`. Redirects now anchor to
  `NEXTAUTH_URL`.

## v1.7.0 — 2026-05-17

The "config moves into the database + one-time setup wizard" release.
Drops 100+ lines of interactive prompts from the installer and lets users
reconfigure everything from inside the panel without editing `.env`.

### Added
- **Light mode** with site-wide toggle in the topbar. CSS variables under
  `[data-theme="dark"]` / `[data-theme="light"]` flip the chrome and shared
  UI primitives. Per-page polish is incremental — sub-pages stay
  readable but a few will get touched up in v1.7.1.
- **Mobile-responsive sidebar parity.** Mobile drawer was missing five nav
  entries (apps, recordings, batch actions, schedules, security) — fixed
  by extracting a shared `nav-items.tsx` module. Server picker now lives
  inside the mobile drawer instead of squeezing the topbar.
- **First-run setup wizard at `/setup`.** Fresh installs boot into a
  4-step wizard (welcome → Discord OAuth → optional integrations →
  finish) instead of crashing on missing env vars. Token-gated entry,
  short-lived signed cookie for the rest of the flow.
- **Config-in-database layer (`src/lib/config.ts`).** 25 settings that
  used to require `.env` edits + container restart now live in
  `AppSetting` and are editable from the wizard / settings page. Sync
  snapshot (`src/lib/config-snapshot.ts`) lets `auth.ts` read Discord
  creds without an async refactor.
- **First-boot migration (`src/lib/config-migrate.ts`).** v1.6 installs
  with Discord/SSH/Cloudflare/Ollama in `.env` get their values seeded
  into `AppSetting` automatically on first start of v1.7. Idempotent.
  Placeholder values (`changeme`, `xxx`, `<token>`) are skipped so the
  wizard still fires for partially-configured boxes.
- **Setup token banner on every boot in setup mode.** The container logs
  print a bordered banner with the `/setup?token=…` URL. Token rotates
  on every restart until setup completes.

### Changed
- **Installer is ~120 lines shorter.** Removed the inline Discord OAuth
  wizard, the SSH-to-self wizard, and the Cloudflare cert prompts. They
  all run inside the panel now. `install.sh` writes a 6-line `.env`
  (DATABASE_URL, NEXTAUTH_URL, NEXTAUTH_SECRET, AUTH_TRUST_HOST,
  APP_PORT, CP_SETUP_TOKEN) and points the user at the wizard.
- **`env.ts` schema relaxed.** `DISCORD_CLIENT_ID` and
  `DISCORD_CLIENT_SECRET` are no longer required at boot — fresh
  installs need to reach `/setup` before they can attempt a login.
- **Topbar uses CSS variables.** `bg-black/50` → `bg-background-elevated/80`,
  same for sidebars and the glass primitives.

### Migration notes for v1.6 users
- Existing `.env` keeps working unchanged. On first boot of v1.7, the
  panel reads from `AppSetting` first and falls back to `.env` second.
- The migration step logs exactly which keys it seeded, so you have a
  clean list to delete from `.env` after restart.
- `NEXTAUTH_URL` MUST stay in `.env` — NextAuth reads it at module
  load. Changing it still requires editing `.env` and restarting.

### Known limitations
- The setup token is printed to `docker logs`. Anyone on the LAN who can
  read the logs (or guess 16 random hex chars in 2^64 attempts) becomes
  OWNER. Mitigate by binding the panel to `127.0.0.1` and tunneling, or
  put it behind Cloudflare from the start.
- Light mode v1 themes the chrome and shared primitives only — some
  sub-pages with hand-rolled gradient backgrounds read as "fine but a
  little rough" in light mode. Per-page polish lands in v1.7.1.

### Deferred to v1.8+
- Remote SQL console with editor + history + CSV export
- Container template builder
- Resource quotas per user
- i18n scaffolding
- Streaming build logs

---

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
