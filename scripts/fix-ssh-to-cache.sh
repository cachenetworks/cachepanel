#!/usr/bin/env bash
# CachePanel — one-shot fix to point the browser terminal at the LOCAL `cache`
# user on this host. Cleans up any prior cache_admin configuration.
#
#   sudo bash scripts/fix-ssh-to-cache.sh
#
# Idempotent. Re-run any time things drift.
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run with sudo:  sudo bash $0" >&2
  exit 1
fi

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SECRETS_DIR="${PROJECT_DIR}/secrets"
ENV_FILE="${PROJECT_DIR}/.env"
KEY="${SECRETS_DIR}/cachepanel_id_ed25519"
PUB="${KEY}.pub"
KNOWN_HOSTS="${SECRETS_DIR}/known_hosts"

CONTAINER_UID=1001
CONTAINER_GID=1001
SSH_USER="cache"
SSH_PORT="22"
SSH_HOST="host.docker.internal"

echo "==> Target: ${SSH_USER}@${SSH_HOST}:${SSH_PORT}"
echo "==> Project: ${PROJECT_DIR}"
echo

# ---------------------------------------------------------------------------
# 0. Make sure the 'cache' Linux user exists.
# ---------------------------------------------------------------------------
if ! getent passwd "$SSH_USER" >/dev/null; then
  echo "==> Creating system user '${SSH_USER}'…"
  adduser --disabled-password --gecos "" "$SSH_USER"
fi
TARGET_HOME="$(getent passwd "$SSH_USER" | cut -d: -f6)"
echo "    home: ${TARGET_HOME}"

# ---------------------------------------------------------------------------
# 1. Clean up any prior 'cache_admin' artifacts. (Leaves the user account
#    itself alone in case you have data there — only removes CachePanel's
#    sudoers fragment for it.)
# ---------------------------------------------------------------------------
if [[ -f /etc/sudoers.d/cachepanel-cache_admin ]]; then
  echo "==> Removing stale /etc/sudoers.d/cachepanel-cache_admin"
  rm -f /etc/sudoers.d/cachepanel-cache_admin
fi

# ---------------------------------------------------------------------------
# 2. Make sure SSH is installed + running on the host.
# ---------------------------------------------------------------------------
if ! command -v sshd >/dev/null 2>&1; then
  echo "==> Installing openssh-server…"
  apt-get update -y
  apt-get install -y --no-install-recommends openssh-server
fi
systemctl enable ssh >/dev/null 2>&1 || true
systemctl start ssh  >/dev/null 2>&1 || true

# ---------------------------------------------------------------------------
# 3. Generate the keypair (if missing) and lock down ownership/perms so
#    UID 1001 inside the container can read the private key.
# ---------------------------------------------------------------------------
mkdir -p "$SECRETS_DIR"
if [[ ! -f "$KEY" ]]; then
  echo "==> Generating ed25519 keypair at ${KEY}"
  ssh-keygen -t ed25519 -N '' -C "cachepanel@$(hostname)" -f "$KEY" >/dev/null
fi
chown "${CONTAINER_UID}:${CONTAINER_GID}" "$KEY" "$PUB"
chmod 600 "$KEY"
chmod 644 "$PUB"
chmod 755 "$SECRETS_DIR"

# ---------------------------------------------------------------------------
# 4. Capture host key under every name the container might use.
# ---------------------------------------------------------------------------
echo "==> Capturing host SSH key…"
TMP="$(mktemp)"
TMP_RAW="$(mktemp)"
trap 'rm -f "$TMP" "$TMP_RAW"' EXIT

REAL_IP="$(hostname -I | awk '{print $1}')"
DOCKER_GATEWAY=""
if command -v docker >/dev/null 2>&1; then
  DOCKER_GATEWAY="$(docker network inspect bridge -f '{{(index .IPAM.Config 0).Gateway}}' 2>/dev/null || true)"
fi

scan() {
  local target="$1"; local label="$2"
  : > "$TMP_RAW"
  if ssh-keyscan -T 5 -p "$SSH_PORT" "$target" 2>/dev/null > "$TMP_RAW" && [[ -s "$TMP_RAW" ]]; then
    awk -v lbl="$label" '{ $1 = lbl; print }' "$TMP_RAW" >> "$TMP"
    echo "    captured ${target} → labelled as ${label}"
    return 0
  fi
  return 1
}

got=0
scan "$REAL_IP"         "$SSH_HOST"   && got=1
scan "$REAL_IP"         "$REAL_IP"    || true
[[ -n "$DOCKER_GATEWAY" && "$DOCKER_GATEWAY" != "$REAL_IP" ]] && {
  scan "$DOCKER_GATEWAY" "$SSH_HOST"   || true
  scan "$DOCKER_GATEWAY" "$DOCKER_GATEWAY" || true
}
scan "127.0.0.1"        "$SSH_HOST"   || true
[[ "$got" -eq 0 ]] && scan "localhost" "$SSH_HOST" && got=1

if [[ "$got" -ne 1 ]]; then
  echo "ERROR: ssh-keyscan could not reach SSH on this host." >&2
  echo "       Check: sudo systemctl status ssh" >&2
  exit 1
fi

sort -u "$TMP" > "$KNOWN_HOSTS"
chown "${CONTAINER_UID}:${CONTAINER_GID}" "$KNOWN_HOSTS"
chmod 644 "$KNOWN_HOSTS"

# ---------------------------------------------------------------------------
# 5. Authorize the public key on cache's account, with correct perms.
# ---------------------------------------------------------------------------
echo "==> Installing public key into ${TARGET_HOME}/.ssh/authorized_keys"
install -d -m 700 -o "$SSH_USER" -g "$SSH_USER" "${TARGET_HOME}/.ssh"
touch "${TARGET_HOME}/.ssh/authorized_keys"
chown "${SSH_USER}:${SSH_USER}" "${TARGET_HOME}/.ssh/authorized_keys"
chmod 600 "${TARGET_HOME}/.ssh/authorized_keys"
# Also tighten the home dir itself — group-writable homes break key auth.
chmod 755 "${TARGET_HOME}"

PUBKEY="$(cat "$PUB")"
if ! grep -qF "$PUBKEY" "${TARGET_HOME}/.ssh/authorized_keys"; then
  echo "$PUBKEY" >> "${TARGET_HOME}/.ssh/authorized_keys"
  echo "    appended"
else
  echo "    already present"
fi

# ---------------------------------------------------------------------------
# 6. Give 'cache' a valid login shell and passwordless sudo.
# ---------------------------------------------------------------------------
CURRENT_SHELL="$(getent passwd "$SSH_USER" | cut -d: -f7)"
if [[ "$CURRENT_SHELL" == "/usr/sbin/nologin" || "$CURRENT_SHELL" == "/bin/false" || -z "$CURRENT_SHELL" ]]; then
  echo "==> Setting login shell for ${SSH_USER} to /bin/bash"
  chsh -s /bin/bash "$SSH_USER"
fi

# Make sure the password isn't locked (a locked password also blocks
# pubkey login on some PAM configurations).
if passwd -S "$SSH_USER" 2>/dev/null | awk '{print $2}' | grep -qE '^L'; then
  echo "==> Unlocking ${SSH_USER} (key auth only — no actual password set)"
  usermod -p '*' "$SSH_USER"
fi

SUDOERS_FILE="/etc/sudoers.d/cachepanel-${SSH_USER}"
echo "==> Granting ${SSH_USER} passwordless sudo (${SUDOERS_FILE})"
cat > "${SUDOERS_FILE}.new" <<EOF
# CachePanel: passwordless sudo for the browser-terminal user. Remove this
# file to revert.
${SSH_USER} ALL=(ALL) NOPASSWD: ALL
EOF
chmod 0440 "${SUDOERS_FILE}.new"
if visudo -cf "${SUDOERS_FILE}.new" >/dev/null; then
  mv "${SUDOERS_FILE}.new" "${SUDOERS_FILE}"
else
  rm -f "${SUDOERS_FILE}.new"
  echo "ERROR: refused to install invalid sudoers fragment." >&2
  exit 1
fi
# Put cache in the sudo / wheel group too so the rule is honored.
if getent group sudo >/dev/null && ! id -nG "$SSH_USER" | tr ' ' '\n' | grep -qx sudo; then
  usermod -aG sudo "$SSH_USER"
elif getent group wheel >/dev/null && ! id -nG "$SSH_USER" | tr ' ' '\n' | grep -qx wheel; then
  usermod -aG wheel "$SSH_USER"
fi

# ---------------------------------------------------------------------------
# 7. Patch .env — force SSH_USER=cache and all related vars. Idempotent.
# ---------------------------------------------------------------------------
if [[ ! -f "$ENV_FILE" ]]; then
  echo "==> Creating ${ENV_FILE} from .env.example"
  cp "${PROJECT_DIR}/.env.example" "$ENV_FILE"
fi
set_env_var() {
  local key="$1"; local value="$2"
  if grep -qE "^${key}=" "$ENV_FILE"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}
echo "==> Patching ${ENV_FILE}"
set_env_var SSH_HOST          "$SSH_HOST"
set_env_var SSH_PORT          "$SSH_PORT"
set_env_var SSH_USER          "$SSH_USER"
set_env_var SSH_KEY_PATH      "/run/secrets/cachepanel_id_ed25519"
set_env_var SSH_KNOWN_HOSTS   "/run/secrets/known_hosts"

# ---------------------------------------------------------------------------
# 8. Smoke-test the SSH login from inside the container BEFORE relying on
#    the browser. Fails loudly if something's still wrong.
# ---------------------------------------------------------------------------
echo "==> Recreating cachepanel app container (so .env changes take effect)…"
( cd "$PROJECT_DIR" && docker compose up -d --force-recreate app ) >/dev/null

echo "==> Waiting 3s for app to come up…"
sleep 3

echo "==> Smoke-testing SSH from inside the container…"
if docker compose -f "${PROJECT_DIR}/docker-compose.yml" exec -T app \
     ssh -i /run/secrets/cachepanel_id_ed25519 \
         -o UserKnownHostsFile=/run/secrets/known_hosts \
         -o StrictHostKeyChecking=yes \
         -o BatchMode=yes \
         -o ConnectTimeout=5 \
         -p "$SSH_PORT" "${SSH_USER}@${SSH_HOST}" \
         'echo "OK from $(whoami)@$(hostname)"' 2>/tmp/cp-ssh-test.log; then
  echo
  echo "================================================================"
  echo "  ✓ SSH works. Hard-refresh the Terminal page in your browser."
  echo "    Prompt should now read:  ${SSH_USER}@$(hostname):~\$"
  echo "================================================================"
else
  echo
  echo "================================================================"
  echo "  ✗ SSH smoke test FAILED. Debug output:"
  echo "----------------------------------------------------------------"
  cat /tmp/cp-ssh-test.log
  echo "----------------------------------------------------------------"
  echo "  Common causes:"
  echo "    • sshd refuses pubkey auth → check /etc/ssh/sshd_config"
  echo "      and /etc/ssh/sshd_config.d/*.conf for PubkeyAuthentication"
  echo "    • Home dir is group-writable → ls -lad ${TARGET_HOME}"
  echo "    • Selinux/AppArmor blocking ~/.ssh — check sudo journalctl -u ssh"
  echo "================================================================"
  exit 1
fi
