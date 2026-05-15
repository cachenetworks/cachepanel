#!/usr/bin/env bash
# CachePanel — host install script (no Docker).
# Run this as root on the Ubuntu/Debian server you want to manage.
#
#   sudo bash scripts/install-host.sh
#
# What it does:
#   1. Installs Node 20, build deps, and the node-pty native module
#   2. Creates a dedicated `cachepanel` system user that owns the app
#   3. Installs the app to /opt/cachepanel and runs `npm install` + `next build`
#   4. Sets up /etc/cachepanel/.env (you fill it in)
#   5. Installs a systemd unit `cachepanel.service` and starts it
#
# The terminal feature will spawn a shell as TERMINAL_USER (default: the
# invoking sudo user) so you get your real server, not a container shell.
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run with sudo: sudo bash $0" >&2
  exit 1
fi

APP_DIR="/opt/cachepanel"
DATA_DIR="/var/lib/cachepanel"
ETC_DIR="/etc/cachepanel"
RUN_USER="cachepanel"
DEFAULT_TERMINAL_USER="${SUDO_USER:-root}"

echo "==> Installing system packages…"
apt-get update -y
apt-get install -y --no-install-recommends \
  curl ca-certificates gnupg build-essential python3 git sqlite3

if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | sed 's/^v//;s/\..*//')" -lt 20 ]]; then
  echo "==> Installing Node.js 20…"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

echo "==> Creating system user '${RUN_USER}'…"
if ! id "${RUN_USER}" >/dev/null 2>&1; then
  useradd --system --create-home --home-dir "/home/${RUN_USER}" --shell /usr/sbin/nologin "${RUN_USER}"
fi

echo "==> Preparing directories…"
mkdir -p "${APP_DIR}" "${DATA_DIR}" "${ETC_DIR}"

# Copy the repo into /opt/cachepanel.
SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"
echo "==> Copying app from ${SRC_DIR} → ${APP_DIR}…"
rsync -a --delete \
  --exclude node_modules --exclude .next --exclude .git --exclude data \
  "${SRC_DIR}/" "${APP_DIR}/"

chown -R "${RUN_USER}:${RUN_USER}" "${APP_DIR}" "${DATA_DIR}"

echo "==> Installing npm dependencies…"
sudo -u "${RUN_USER}" --preserve-env=PATH bash -c "cd '${APP_DIR}' && npm install --no-audit --no-fund"

echo "==> Building the app…"
sudo -u "${RUN_USER}" --preserve-env=PATH bash -c "cd '${APP_DIR}' && npx prisma generate && npm run build"

# Create the env file once. We never overwrite it on subsequent runs.
if [[ ! -f "${ETC_DIR}/cachepanel.env" ]]; then
  echo "==> Generating ${ETC_DIR}/cachepanel.env…"
  RAND_SECRET="$(openssl rand -base64 32)"
  cat > "${ETC_DIR}/cachepanel.env" <<EOF
# CachePanel runtime environment.
# Edit, then: sudo systemctl restart cachepanel

DATABASE_URL=file:${DATA_DIR}/cachepanel.db

NEXTAUTH_URL=http://localhost:8992
NEXTAUTH_SECRET=${RAND_SECRET}

DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
DISCORD_GUILD_ID=
DISCORD_ALLOWED_ROLE_IDS=
DISCORD_ALLOWED_USER_IDS=

ADMIN_CAN_APPROVE_USERS=false

# Real paths on this host that the file manager may read/write.
ALLOWED_FILE_ROOTS=/home,/srv,/var/www,/etc

# Terminal launches a shell as this user. Defaults to the user who ran the
# installer with sudo (root if you ran it as root). Change to whichever
# limited Linux account you want CachePanel to drop into.
TERMINAL_ENABLED=true
TERMINAL_SHELL=/bin/bash
TERMINAL_USER=${DEFAULT_TERMINAL_USER}
TERMINAL_START_DIR=/home/${DEFAULT_TERMINAL_USER}
TERMINAL_AUDIT_COMMANDS=false

APP_PORT=8992
EOF
  chmod 600 "${ETC_DIR}/cachepanel.env"
  chown "${RUN_USER}:${RUN_USER}" "${ETC_DIR}/cachepanel.env"
fi

# CachePanel needs the right to spawn shells as TERMINAL_USER. Grant the
# cachepanel system user passwordless `su` to that account ONLY.
TERMINAL_USER_FROM_ENV="$(grep -E '^TERMINAL_USER=' "${ETC_DIR}/cachepanel.env" | cut -d= -f2- | tr -d '"')"
TERMINAL_USER_FROM_ENV="${TERMINAL_USER_FROM_ENV:-${DEFAULT_TERMINAL_USER}}"
SUDOERS_FILE="/etc/sudoers.d/cachepanel"
echo "==> Granting ${RUN_USER} passwordless su to ${TERMINAL_USER_FROM_ENV}…"
cat > "${SUDOERS_FILE}" <<EOF
# Allow CachePanel to open a login shell as the configured terminal user.
${RUN_USER} ALL=(${TERMINAL_USER_FROM_ENV}) NOPASSWD: /bin/bash, /bin/su, /usr/bin/login
EOF
chmod 0440 "${SUDOERS_FILE}"
visudo -cf "${SUDOERS_FILE}" >/dev/null

echo "==> Applying database migrations…"
sudo -u "${RUN_USER}" --preserve-env=PATH bash -c "cd '${APP_DIR}' && DATABASE_URL='file:${DATA_DIR}/cachepanel.db' npx prisma migrate deploy"

echo "==> Installing systemd unit…"
cat > /etc/systemd/system/cachepanel.service <<EOF
[Unit]
Description=CachePanel — Secure server control, the Cache way.
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${RUN_USER}
Group=${RUN_USER}
WorkingDirectory=${APP_DIR}
EnvironmentFile=${ETC_DIR}/cachepanel.env
ExecStart=/usr/bin/node ${APP_DIR}/server.js
Restart=always
RestartSec=3
# Hardening — keep CachePanel boxed in, but allow it to spawn its own shells.
NoNewPrivileges=false
ProtectSystem=full
ProtectHome=no
ReadWritePaths=${DATA_DIR}
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable cachepanel.service
systemctl restart cachepanel.service

echo
echo "================================================================"
echo "  CachePanel installed."
echo
echo "  Edit:    ${ETC_DIR}/cachepanel.env"
echo "  Reload:  sudo systemctl restart cachepanel"
echo "  Logs:    sudo journalctl -u cachepanel -f"
echo "  URL:     http://$(hostname -I | awk '{print $1}'):8992"
echo
echo "  Terminal will open a shell as: ${TERMINAL_USER_FROM_ENV}"
echo "================================================================"
