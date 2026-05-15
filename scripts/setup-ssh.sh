#!/usr/bin/env bash
# CachePanel SSH-to-host setup — one-shot.
#
# Run from the project root:
#   sudo bash scripts/setup-ssh.sh <ssh-user> [ssh-host] [ssh-port]
#
# Example:
#   sudo bash scripts/setup-ssh.sh cache_og host.docker.internal 22
#
# What it does (idempotent — safe to re-run):
#   1. Generates ./secrets/cachepanel_id_ed25519 (keypair) if missing
#   2. Sets permissions/ownership so the in-container UID 1001 can read them
#   3. Captures the host's SSH key into ./secrets/known_hosts under EVERY
#      name the container might use (host.docker.internal + real LAN IP)
#   4. Appends the public key to ~<ssh-user>/.ssh/authorized_keys
#   5. Grants the user passwordless sudo (so the browser terminal never
#      prompts for a sudo password)
#   6. Rewrites the SSH_* lines in your .env so the app uses them
#   7. Restarts the cachepanel docker compose service
#
# Flag: --no-passwordless-sudo   skip step 5 if you don't want this.
set -euo pipefail

PASSWORDLESS_SUDO=1
ARGS=()
for arg in "$@"; do
  case "$arg" in
    --no-passwordless-sudo) PASSWORDLESS_SUDO=0 ;;
    *) ARGS+=("$arg") ;;
  esac
done
set -- "${ARGS[@]:-}"

USER_ARG="${1:-}"
HOST_ARG="${2:-host.docker.internal}"
PORT_ARG="${3:-22}"

if [[ -z "$USER_ARG" ]]; then
  echo "Usage: sudo bash scripts/setup-ssh.sh <ssh-user> [ssh-host] [ssh-port]" >&2
  echo "Example: sudo bash scripts/setup-ssh.sh cache_og host.docker.internal 22" >&2
  exit 1
fi

if [[ "${EUID}" -ne 0 ]]; then
  echo "This script needs root (it writes to /etc and to another user's ~/.ssh)." >&2
  echo "Run:  sudo bash scripts/setup-ssh.sh $*" >&2
  exit 1
fi

# Resolve "the project root" reliably even when run via sudo.
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SECRETS_DIR="${PROJECT_DIR}/secrets"
ENV_FILE="${PROJECT_DIR}/.env"
KEY="${SECRETS_DIR}/cachepanel_id_ed25519"
PUB="${KEY}.pub"
KNOWN_HOSTS="${SECRETS_DIR}/known_hosts"

# Inside the Docker container the volume mounts to /run/secrets, and the
# process runs as UID 1001 (the 'cache' user). The files need to be readable
# by that UID. We chown them to UID 1001 directly so it works regardless of
# whether a 'cache' user exists on the host.
CONTAINER_UID=1001
CONTAINER_GID=1001

echo "==> Project: ${PROJECT_DIR}"
echo "==> SSH target: ${USER_ARG}@${HOST_ARG}:${PORT_ARG}"
echo

# ---------------------------------------------------------------------------
# 1. Make sure the target Linux user actually exists on this host.
# ---------------------------------------------------------------------------
if ! getent passwd "$USER_ARG" >/dev/null; then
  echo "ERROR: user '${USER_ARG}' does not exist on this host." >&2
  echo "       Create them first, e.g.:" >&2
  echo "         sudo adduser --disabled-password ${USER_ARG}" >&2
  echo "         sudo usermod -aG sudo ${USER_ARG}   # optional" >&2
  exit 1
fi
TARGET_HOME="$(getent passwd "$USER_ARG" | cut -d: -f6)"

# ---------------------------------------------------------------------------
# 2. Generate the keypair if missing, and lock down permissions.
# ---------------------------------------------------------------------------
mkdir -p "$SECRETS_DIR"
if [[ ! -f "$KEY" ]]; then
  echo "==> Generating ed25519 keypair at ${KEY}"
  ssh-keygen -t ed25519 -N '' -C "cachepanel@$(hostname)" -f "$KEY" >/dev/null
fi

# The container reads these as UID 1001 — make them readable by that UID
# while staying private (mode 600 on the private key).
chown "${CONTAINER_UID}:${CONTAINER_GID}" "$KEY" "$PUB"
chmod 600 "$KEY"
chmod 644 "$PUB"
# The secrets directory itself must be traversable by UID 1001.
chmod 755 "$SECRETS_DIR"

# ---------------------------------------------------------------------------
# 3. Capture the host key under every hostname the container might use.
# ---------------------------------------------------------------------------
# Figure out the host's real LAN/Docker-gateway IP. host.docker.internal
# inside the container resolves to the host-gateway address — usually one of
# the docker0 / br-* IPs on Linux.
REAL_IP="$(hostname -I | awk '{print $1}')"
DOCKER_GATEWAY=""
if command -v docker >/dev/null 2>&1; then
  DOCKER_GATEWAY="$(docker network inspect bridge -f '{{(index .IPAM.Config 0).Gateway}}' 2>/dev/null || true)"
fi

echo "==> Capturing host SSH key…"
TMP_KH="$(mktemp)"
trap 'rm -f "$TMP_KH"' EXIT

scan_into() {
  local target="$1"
  local label="$2"
  if ssh-keyscan -T 5 -p "$PORT_ARG" "$target" 2>/dev/null >> "$TMP_KH.raw"; then
    # Re-label every captured line so it matches the name SSH will actually
    # use when connecting (host.docker.internal / hostname / IP).
    awk -v lbl="$label" '{ $1 = lbl; print }' "$TMP_KH.raw" >> "$TMP_KH"
    rm -f "$TMP_KH.raw"
    echo "      captured for ${label}"
    return 0
  fi
  rm -f "$TMP_KH.raw"
  return 1
}

# Try the literal HOST_ARG, then the real LAN IP, then the docker gateway IP.
captured=0
if scan_into "$HOST_ARG" "$HOST_ARG"; then captured=1; fi
if [[ -n "$REAL_IP" && "$REAL_IP" != "$HOST_ARG" ]]; then
  if scan_into "$REAL_IP" "$HOST_ARG"; then captured=1; fi
  scan_into "$REAL_IP" "$REAL_IP" || true
fi
if [[ -n "$DOCKER_GATEWAY" && "$DOCKER_GATEWAY" != "$REAL_IP" ]]; then
  scan_into "$DOCKER_GATEWAY" "$HOST_ARG" || true
  scan_into "$DOCKER_GATEWAY" "$DOCKER_GATEWAY" || true
fi

if [[ "$captured" -ne 1 ]]; then
  echo "ERROR: ssh-keyscan could not reach any address for the host." >&2
  echo "       Is the SSH server running? ( sudo systemctl status ssh )" >&2
  exit 1
fi

# De-duplicate and write to the real known_hosts file.
sort -u "$TMP_KH" > "$KNOWN_HOSTS"
chown "${CONTAINER_UID}:${CONTAINER_GID}" "$KNOWN_HOSTS"
chmod 644 "$KNOWN_HOSTS"

# ---------------------------------------------------------------------------
# 4. Authorize the public key on the target Linux account.
# ---------------------------------------------------------------------------
echo "==> Authorizing public key on ${USER_ARG}@host"
install -d -m 700 -o "$USER_ARG" -g "$USER_ARG" "${TARGET_HOME}/.ssh"
touch "${TARGET_HOME}/.ssh/authorized_keys"
chown "${USER_ARG}:${USER_ARG}" "${TARGET_HOME}/.ssh/authorized_keys"
chmod 600 "${TARGET_HOME}/.ssh/authorized_keys"

PUBKEY="$(cat "$PUB")"
if ! grep -qF "$PUBKEY" "${TARGET_HOME}/.ssh/authorized_keys"; then
  echo "$PUBKEY" >> "${TARGET_HOME}/.ssh/authorized_keys"
  echo "      added to ${TARGET_HOME}/.ssh/authorized_keys"
else
  echo "      already present in ${TARGET_HOME}/.ssh/authorized_keys"
fi

# ---------------------------------------------------------------------------
# 5. Grant the SSH user passwordless sudo (so the browser terminal never
#    has to prompt for a password).
# ---------------------------------------------------------------------------
SUDOERS_FILE="/etc/sudoers.d/cachepanel-${USER_ARG}"
if [[ "$PASSWORDLESS_SUDO" -eq 1 ]]; then
  echo "==> Granting ${USER_ARG} passwordless sudo (${SUDOERS_FILE})"
  cat > "${SUDOERS_FILE}.new" <<EOF
# CachePanel: allow the browser-terminal SSH user to run sudo without a
# password prompt. Remove this file to revert.
${USER_ARG} ALL=(ALL) NOPASSWD: ALL
EOF
  chmod 0440 "${SUDOERS_FILE}.new"
  if visudo -cf "${SUDOERS_FILE}.new" >/dev/null; then
    mv "${SUDOERS_FILE}.new" "${SUDOERS_FILE}"
  else
    echo "ERROR: refused to install invalid sudoers fragment." >&2
    rm -f "${SUDOERS_FILE}.new"
    exit 1
  fi
  # Make sure the user is actually in a group that sudoers respects on this
  # distro. Both Debian/Ubuntu ('sudo') and RHEL ('wheel') are covered.
  if getent group sudo >/dev/null && ! id -nG "$USER_ARG" | tr ' ' '\n' | grep -qx sudo; then
    usermod -aG sudo "$USER_ARG"
  elif getent group wheel >/dev/null && ! id -nG "$USER_ARG" | tr ' ' '\n' | grep -qx wheel; then
    usermod -aG wheel "$USER_ARG"
  fi
else
  echo "==> Skipping passwordless sudo (--no-passwordless-sudo was passed)"
  # Don't leave stale rules behind from a previous run.
  rm -f "${SUDOERS_FILE}"
fi

# ---------------------------------------------------------------------------
# 6. Patch .env — overwrite SSH_* keys cleanly, leave everything else alone.
# ---------------------------------------------------------------------------
if [[ ! -f "$ENV_FILE" ]]; then
  echo "==> Creating ${ENV_FILE} (no existing .env found)…"
  if [[ -f "${PROJECT_DIR}/.env.example" ]]; then
    cp "${PROJECT_DIR}/.env.example" "$ENV_FILE"
  else
    : > "$ENV_FILE"
  fi
fi

set_env_var() {
  local key="$1"
  local value="$2"
  if grep -qE "^${key}=" "$ENV_FILE"; then
    # Replace in place. Use a delimiter that won't appear in our values.
    sed -i "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}

echo "==> Updating ${ENV_FILE}"
set_env_var SSH_HOST          "$HOST_ARG"
set_env_var SSH_PORT          "$PORT_ARG"
set_env_var SSH_USER          "$USER_ARG"
set_env_var SSH_KEY_PATH      "/run/secrets/cachepanel_id_ed25519"
set_env_var SSH_KNOWN_HOSTS   "/run/secrets/known_hosts"

# ---------------------------------------------------------------------------
# 7. Restart the app so the new env takes effect.
# ---------------------------------------------------------------------------
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  echo "==> Recreating cachepanel app container so .env changes apply…"
  ( cd "$PROJECT_DIR" && docker compose up -d --force-recreate app ) || \
    echo "      (couldn't recreate automatically — run: docker compose up -d --force-recreate app)"
fi

cat <<EOF

================================================================
  SSH setup complete.

  Key:          ${KEY}
  Public key:   ${PUB}
  known_hosts:  ${KNOWN_HOSTS}
  authorized:   ${TARGET_HOME}/.ssh/authorized_keys
  sudoers:      $([[ "$PASSWORDLESS_SUDO" -eq 1 ]] && echo "${SUDOERS_FILE} (NOPASSWD: ALL)" || echo "(skipped)")

  .env was updated with:
    SSH_HOST=${HOST_ARG}
    SSH_PORT=${PORT_ARG}
    SSH_USER=${USER_ARG}
    SSH_KEY_PATH=/run/secrets/cachepanel_id_ed25519
    SSH_KNOWN_HOSTS=/run/secrets/known_hosts

  Hard-refresh the Terminal page in your browser. The prompt
  should now read ${USER_ARG}@$(hostname) — your real host.
================================================================
EOF
