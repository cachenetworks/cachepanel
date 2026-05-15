#!/bin/bash
# CachePanel container entrypoint (SQLite edition).
#
# Runs as root, then drops to the `cache` user via gosu after performing
# privileged setup that the unprivileged user can't do itself:
#   1. Detect the docker-group GID from /var/run/docker.sock and add `cache`
#      to it so the panel can talk to the daemon without manual DOCKER_GID.
#   2. Make sure /app/data + /run/secrets-users are writable by `cache`.
#   3. Apply Prisma migrations.
set -euo pipefail

APP_USER="${APP_USER:-cache}"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "[cachepanel] FATAL: DATABASE_URL is not set." >&2
  exit 1
fi

# Behind Cloudflare / Nginx: trust forwarded headers and tell NextAuth where
# the app actually listens internally so server-side calls don't try to go
# back out through the proxy.
export AUTH_TRUST_HOST="${AUTH_TRUST_HOST:-true}"
export NEXTAUTH_URL_INTERNAL="${NEXTAUTH_URL_INTERNAL:-http://127.0.0.1:${APP_PORT:-8992}}"

# ---------------------------------------------------------------------------
# Privileged setup (only when started as root)
# ---------------------------------------------------------------------------
if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
  # 1. Auto-detect the host's docker group GID from the mounted socket so
  # `cache` can read /var/run/docker.sock without anyone editing .env.
  if [[ -S /var/run/docker.sock ]]; then
    DOCK_GID="$(stat -c '%g' /var/run/docker.sock 2>/dev/null || echo '')"
    if [[ -n "$DOCK_GID" && "$DOCK_GID" =~ ^[0-9]+$ ]]; then
      # Ensure a group with that GID exists (create one if not).
      if ! getent group "$DOCK_GID" >/dev/null; then
        groupadd --system --gid "$DOCK_GID" hostdocker || true
      fi
      # Add the cache user to that group.
      if ! id -nG "$APP_USER" | tr ' ' '\n' | grep -qx "$(getent group "$DOCK_GID" | cut -d: -f1)"; then
        usermod -aG "$DOCK_GID" "$APP_USER" || true
        echo "[cachepanel] Added ${APP_USER} to docker group (gid ${DOCK_GID})."
      else
        echo "[cachepanel] ${APP_USER} already in docker group (gid ${DOCK_GID})."
      fi
    else
      echo "[cachepanel] WARN: /var/run/docker.sock present but couldn't read GID."
    fi
  else
    echo "[cachepanel] Docker socket not mounted — Docker page will be unavailable."
  fi

  # 2. Ensure writable dirs on bind-mounted volumes.
  for dir in /app/data /run/secrets-users /run/secrets-servers; do
    if [[ -d "$dir" ]]; then
      chown "$APP_USER":"$APP_USER" "$dir" 2>/dev/null || true
    fi
  done

  # 3. Migrations need to run as the user that will own the SQLite file.
  exec gosu "$APP_USER" "$0" "$@"
fi

# ---------------------------------------------------------------------------
# Unprivileged half (re-entered as `cache` via gosu)
# ---------------------------------------------------------------------------

# Make sure the SQLite file's directory exists.
db_path="${DATABASE_URL#file:}"
db_dir="$(dirname "$db_path")"
mkdir -p "$db_dir" 2>/dev/null || true

echo "[cachepanel] Applying migrations to ${db_path}…"
PRISMA_BIN="/app/node_modules/.bin/prisma"
if [[ ! -x "$PRISMA_BIN" ]]; then
  echo "[cachepanel] FATAL: ${PRISMA_BIN} is missing from the image." >&2
  exit 1
fi
if ! "$PRISMA_BIN" migrate deploy >/tmp/cp-migrate.log 2>&1; then
  echo "[cachepanel] FATAL: migrations failed." >&2
  cat /tmp/cp-migrate.log >&2 || true
  exit 1
fi
echo "[cachepanel] Migrations applied."

exec "$@"
