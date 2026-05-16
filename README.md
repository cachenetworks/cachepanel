# CachePanel

> **Secure server control, the Cache way.**

> **⚠ Proprietary software.** This source is published for installation,
> use of the official distribution, and public auditability **only**.
> You may **not** copy, modify, fork, redistribute, host as a service, or
> use it to train AI models. See [LICENSE](./LICENSE) for the full terms.
>
> Questions, support, or licensing? **DM me on Discord: `cache_og`**

CachePanel is a dark-mode, Cache-themed Ubuntu server management panel. It
combines a browser terminal, a file manager, server stats, and a multi-user
admin dashboard behind Discord OAuth — all in a single Docker-friendly Next.js
app, ready to expose over a Cloudflare Tunnel.

![CachePanel — neon green and magenta on near-black, glassmorphism cards.](public/favicon.svg)

---

## Features

- **Discord OAuth login** with optional guild + role gating
- **Two-role model: `OWNER` and `ADMIN`** (and only those two)
- **First successful login becomes the OWNER**, every other login is `PENDING`
  until approved
- **Browser terminal** via `node-pty` + `socket.io` + `xterm.js`
- **File manager** with breadcrumbs, upload, download, edit, rename, delete
- **Server stats**: CPU, memory, disk, uptime, OS, Node, Docker
- **Audit log** of every important action (logins, approvals, terminal sessions,
  file operations, settings changes)
- **Dark, neon (Cache) UI** built with Tailwind + shadcn/ui + Radix
- **Cloudflare Tunnel friendly** — listens on `0.0.0.0:8992`, no port forwarding
- **Hardened defaults**: input validation with Zod, path traversal guards on the
  file manager, sensitive-file blocklist, rate-limited auth and write APIs,
  `__Secure-` cookies behind HTTPS, dropped capabilities under Docker, non-root
  container user

---

## Security warnings (please read first)

CachePanel exposes a real shell and a real filesystem. Run it with the same
care you would run any remote-admin tool:

- **Never run the app as `root`.** The Docker image runs as a dedicated `cache`
  user. If you self-host without Docker, create a similar limited user.
- The terminal is gated by Discord OAuth + role/status checks, but a leaked
  Discord account = full shell. **Use a dedicated Discord server with role
  gating** if you can (`DISCORD_GUILD_ID` + `DISCORD_ALLOWED_ROLE_IDS`).
- **`.env` access is disabled by default.** Even an OWNER cannot read `.env`
  files until `ALLOW_DOTENV_ACCESS=true` is set.
- The file manager only sees paths inside `ALLOWED_FILE_ROOTS`. Keep that list
  as small as possible.
- Terminal command logging is **off by default**. Enable
  `TERMINAL_AUDIT_COMMANDS=true` only if you understand that every command line
  will be written to the database.
- Always front CachePanel with TLS (Nginx, Caddy, or Cloudflare Tunnel).
- The app warns on boot if it detects it is running as UID 0.

---

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | Next.js 14 (App Router) + TypeScript |
| Styling | TailwindCSS + shadcn/ui (Radix) |
| Auth | NextAuth.js (Discord provider) |
| DB | SQLite (better-sqlite3) |
| ORM | Prisma |
| Realtime | socket.io |
| Terminal | `node-pty` + `xterm.js` |
| Deploy | Docker + Docker Compose |

---

## Quick start (Docker)

```bash
# 1. Clone and enter the project
cd cachepanel

# 2. Copy and edit env
cp .env.example .env
nano .env   # fill in NEXTAUTH_SECRET, DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET

# 3. Generate a strong NextAuth secret
openssl rand -base64 32   # paste into NEXTAUTH_SECRET

# 4. Bring up the stack
docker compose up -d --build

# 5. Tail logs to watch the first migration + boot
docker compose logs -f app
```

CachePanel is now available at <http://localhost:8992>.

The **first** Discord user to log in becomes the OWNER. Every subsequent user
lands on `/pending` until an OWNER (or an ADMIN, if `ADMIN_CAN_APPROVE_USERS=true`)
approves them on the **Users** page.

---

## Discord OAuth setup

1. Open <https://discord.com/developers/applications> → **New Application**.
2. In **OAuth2 → General**, copy `Client ID` and `Client Secret` into your
   `.env` (`DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`).
3. Add the redirect URL:
   ```
   <NEXTAUTH_URL>/api/auth/callback/discord
   ```
   For example: `https://panel.example.com/api/auth/callback/discord`.
4. (Optional) To restrict logins to one Discord server:
   - Copy the server's ID into `DISCORD_GUILD_ID`.
5. (Optional) To restrict logins to specific roles inside that server:
   - Copy comma-separated role IDs into `DISCORD_ALLOWED_ROLE_IDS`.
   - Requires `DISCORD_GUILD_ID` to be set as well.
6. (Optional, **strongest**) To allow only specific Discord accounts:
   - Enable Developer Mode in Discord (User Settings → Advanced).
   - Right-click your username → **Copy User ID**.
   - Paste comma-separated IDs into `DISCORD_ALLOWED_USER_IDS`.
   - This check runs first and rejects everyone else before any Discord guild
     lookup happens — useful if you don't run a Discord server at all.

The Discord OAuth scope used is `identify email guilds guilds.members.read` —
enough to look up guild membership and role assignments.

---

## Required environment variables

See [`.env.example`](.env.example) for the full list and inline comments. The
essentials:

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | yes | SQLite path, e.g. `file:./data/cachepanel.db` (Compose wires this for you) |
| `NEXTAUTH_URL` | yes | Public URL where CachePanel is reachable |
| `NEXTAUTH_SECRET` | yes | `openssl rand -base64 32` |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` | yes | From Discord dev portal |
| `DISCORD_GUILD_ID` | optional | Restrict to one guild |
| `DISCORD_ALLOWED_ROLE_IDS` | optional | Comma-separated role IDs |
| `DISCORD_ALLOWED_USER_IDS` | optional | Comma-separated Discord user IDs allowlist — strictest gate |
| `ADMIN_CAN_APPROVE_USERS` | optional | Default `false` |
| `ALLOWED_FILE_ROOTS` | recommended | Comma-separated absolute paths |
| `ALLOW_DOTENV_ACCESS` | optional | Default `false` (OWNER-only) |
| `TERMINAL_ENABLED` | optional | Default `true` |
| `TERMINAL_SHELL` | optional | Default `/bin/bash` |
| `TERMINAL_USER` | optional | Drop to this Linux user via `su` when run as root |
| `TERMINAL_START_DIR` | optional | Default `/home/cache` |
| `TERMINAL_AUDIT_COMMANDS` | optional | Default `false` |
| `APP_PORT` | optional | Default `8992` |

---

## Prisma commands

Inside the running container (or locally with the right `DATABASE_URL`):

```bash
# Apply migrations in production (auto-run by the entrypoint)
npx prisma migrate deploy

# Create / iterate migrations in development
npx prisma migrate dev --name <descriptive_name>

# Inspect the DB
npx prisma studio
```

On first boot the Docker entrypoint runs `prisma migrate deploy`
automatically — no manual step required.

---

## How user approval works

```
Discord login → guild check → role check
                                  │
                first user ever? ─┼─► OWNER, APPROVED
                                  │
                                  └─► ADMIN, PENDING ──► /pending
                                                         │
                                                         ▼
                                         OWNER (or ADMIN if allowed) approves
                                                         │
                                                         ▼
                                                  ADMIN, APPROVED
```

- **OWNER** can approve, disable, promote, demote, and delete users.
- **ADMIN** can view users only — unless `ADMIN_CAN_APPROVE_USERS=true`, in
  which case they may approve PENDING users as ADMIN. They can **never** create
  OWNER accounts.
- A user with `status=DISABLED` is rejected at every entrypoint — login, API,
  and websocket.

---

## How to restrict file roots

Set `ALLOWED_FILE_ROOTS` to a comma-separated list of absolute paths the file
manager may operate inside. The file manager:

- refuses anything outside of those roots,
- refuses access to `/etc/shadow`, `/etc/sudoers.d`, `/root/.ssh`, private SSH
  keys, and similar files,
- refuses `.env` files unless `ALLOW_DOTENV_ACCESS=true` **and** the user is
  OWNER,
- shows a yellow "sensitive" badge for any borderline filename (e.g. `*.pem`,
  `*.key`, `.env*`).

In the default Compose file, three named volumes are mounted into the
container — `/home/cache`, `/srv`, and `/var/www` — matching the default
`ALLOWED_FILE_ROOTS`.

---

## How to disable terminal access

Two ways, in order of preference:

1. Toggle the **Enable terminal** setting off on the **Settings** page (OWNER
   only).
2. Set `TERMINAL_ENABLED=false` in `.env` and restart the container.

Both result in a clean "Terminal is disabled" empty state on `/terminal` and a
hard reject on the websocket handshake.

---

## Running behind Cloudflare Tunnel (Starlink-friendly)

Cloudflare Tunnel is the easiest way to expose CachePanel from a residential
or CGNAT (Starlink) connection without port forwarding:

```bash
# Install cloudflared once on the host:
#   https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/install-and-setup/

# Then, with CachePanel running:
cloudflared tunnel --url http://localhost:8992
```

cloudflared will print a `https://<random>.trycloudflare.com` URL. To make it
permanent, create a named tunnel and bind it to a hostname:

```bash
cloudflared tunnel login
cloudflared tunnel create cachepanel
cloudflared tunnel route dns cachepanel panel.example.com

# /etc/cloudflared/config.yml
# tunnel: cachepanel
# credentials-file: /root/.cloudflared/<tunnel-id>.json
# ingress:
#   - hostname: panel.example.com
#     service: http://localhost:8992
#   - service: http_status:404

sudo cloudflared service install
```

After the tunnel is up, **set `NEXTAUTH_URL` to your `https://` hostname** and
restart the container — otherwise OAuth callbacks and the `__Secure-` cookie
will be wrong.

WebSockets traverse Cloudflare Tunnel without any extra config, so the
terminal works out of the box.

---

## Nginx reverse-proxy example

If you prefer a public IP + Nginx instead of Cloudflare Tunnel, see
[`docker/nginx.example.conf`](docker/nginx.example.conf). The two important
pieces:

- `client_max_body_size 200M;` (matches the upload cap)
- `proxy_set_header Upgrade` + `Connection "upgrade"` for the WebSocket on
  `/api/terminal/socket`

---

## Troubleshooting

**`node-pty` fails to build during `npm install`**

The Dockerfile installs `python3 make g++` in the deps stage, which is what
`node-pty` needs. If you're installing locally on Linux, run:

```bash
sudo apt-get install -y python3 make g++
```

On Windows, build inside Docker — `node-pty` is a Unix-only native module in
practice. Local `npm run dev` will run, but `/terminal` will be unavailable
until you switch to Docker or WSL.

**OAuth callback returns "Invalid redirect URI"**

The redirect URI in the Discord developer portal must match
`<NEXTAUTH_URL>/api/auth/callback/discord` *exactly*, including scheme and
port. After changing `NEXTAUTH_URL`, restart the container.

**`Account pending approval` after a fresh DB**

The first successful login becomes OWNER. If your first attempt failed (bad
guild check, wrong client secret, etc.), no user was created. Fix the cause
and log in again — you'll still get OWNER.

**Terminal won't start: "Terminal backend unavailable"**

`node-pty` could not be loaded. In Docker this means the build skipped the
native compile step (check the build logs). Locally on Windows, switch to
Docker or WSL.

**OWNER got locked out**

Connect to the database directly and update the user row:

```sql
UPDATE "User" SET status = 'APPROVED', role = 'OWNER' WHERE "discordId" = '<id>';
```

**Migrations fail with `P1001` or `unable to open database file`**

SQLite expects the directory in `DATABASE_URL` to exist and be writable by
UID 1001 (the container's `cache` user). The entrypoint creates `/app/data`
on first start; if it still fails, check the bind-mount/volume permissions.

---

## Local development

```bash
cp .env.example .env
# DATABASE_URL defaults to file:./prisma/cachepanel.db — no separate DB to run
npm install
npx prisma migrate deploy
npm run dev
```

`npm run dev` boots the custom `server.js` (Next.js + socket.io). The terminal
will work on Linux/macOS; on Windows, develop UI/API features here and verify
the terminal under Docker or WSL.

---

## License

Proprietary — published for install + audit only. No copying, modification,
forking, redistribution, or AI training. Full terms in [LICENSE](./LICENSE).

Need permission, support, or want to chat? Discord: **`cache_og`**
