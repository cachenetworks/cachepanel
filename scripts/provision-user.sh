#!/usr/bin/env bash
# CachePanel — per-user host provisioning.
# Invoked by the panel over SSH as the `cache` service account (which has
# passwordless sudo). Idempotent: safe to call repeatedly.
#
# Usage:
#   provision-user.sh <action> <linux-username> [args...]
#
# Actions:
#   create  <username> <pubkey-base64>      Ensure account exists, install pubkey
#   sudo    <username> <on|off>             Toggle passwordless sudo
#   disable <username>                      Lock the account, revoke sudo
#   delete  <username>                      Remove account + home dir + sudoers
#   pubkey  <username>                      Print authorized_keys (debug)
set -euo pipefail

ACTION="${1:-}"
USERNAME="${2:-}"

if [[ -z "$ACTION" || -z "$USERNAME" ]]; then
  echo "usage: $0 <create|sudo|disable|delete|pubkey> <username> [args]" >&2
  exit 64
fi

# Reject anything that isn't a sane Linux username, since we shell out with it.
if ! [[ "$USERNAME" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]]; then
  echo "invalid username (must match ^[a-z_][a-z0-9_-]{0,31}$)" >&2
  exit 64
fi

SUDOERS_FILE="/etc/sudoers.d/cachepanel-${USERNAME}"

case "$ACTION" in
  create)
    PUBKEY_B64="${3:-}"
    if [[ -z "$PUBKEY_B64" ]]; then
      echo "create: missing pubkey" >&2
      exit 64
    fi
    if ! getent passwd "$USERNAME" >/dev/null; then
      echo "==> creating user ${USERNAME}"
      sudo adduser --disabled-password --gecos '' --shell /bin/bash "$USERNAME"
    else
      echo "==> user ${USERNAME} already exists"
      # Re-enable in case it was previously disabled.
      sudo usermod -U "$USERNAME" 2>/dev/null || true
      sudo usermod -s /bin/bash "$USERNAME" 2>/dev/null || true
      sudo usermod -p '*' "$USERNAME" 2>/dev/null || true
    fi
    HOME_DIR="$(getent passwd "$USERNAME" | cut -d: -f6)"
    sudo install -d -m 700 -o "$USERNAME" -g "$USERNAME" "${HOME_DIR}/.ssh"
    PUBKEY="$(printf '%s' "$PUBKEY_B64" | base64 -d)"
    sudo touch "${HOME_DIR}/.ssh/authorized_keys"
    sudo chown "${USERNAME}:${USERNAME}" "${HOME_DIR}/.ssh/authorized_keys"
    sudo chmod 600 "${HOME_DIR}/.ssh/authorized_keys"
    if ! sudo grep -qF "$PUBKEY" "${HOME_DIR}/.ssh/authorized_keys"; then
      echo "$PUBKEY" | sudo tee -a "${HOME_DIR}/.ssh/authorized_keys" >/dev/null
      echo "==> pubkey installed"
    else
      echo "==> pubkey already present"
    fi
    sudo chmod 755 "${HOME_DIR}"
    echo "OK"
    ;;

  sudo)
    MODE="${3:-off}"
    if [[ "$MODE" == "on" ]]; then
      echo "==> granting ${USERNAME} passwordless sudo"
      printf '# CachePanel: passwordless sudo for browser-terminal user. Remove this file to revert.\n%s ALL=(ALL) NOPASSWD: ALL\n' "$USERNAME" \
        | sudo tee "${SUDOERS_FILE}.new" >/dev/null
      sudo chmod 0440 "${SUDOERS_FILE}.new"
      if sudo visudo -cf "${SUDOERS_FILE}.new" >/dev/null; then
        sudo mv "${SUDOERS_FILE}.new" "${SUDOERS_FILE}"
      else
        sudo rm -f "${SUDOERS_FILE}.new"
        echo "refused: invalid sudoers fragment" >&2
        exit 1
      fi
      if getent group sudo >/dev/null && ! id -nG "$USERNAME" | tr ' ' '\n' | grep -qx sudo; then
        sudo usermod -aG sudo "$USERNAME"
      elif getent group wheel >/dev/null && ! id -nG "$USERNAME" | tr ' ' '\n' | grep -qx wheel; then
        sudo usermod -aG wheel "$USERNAME"
      fi
    else
      echo "==> revoking sudo for ${USERNAME}"
      sudo rm -f "${SUDOERS_FILE}"
    fi
    echo "OK"
    ;;

  disable)
    echo "==> disabling ${USERNAME}"
    sudo rm -f "${SUDOERS_FILE}"
    sudo usermod -L "$USERNAME" 2>/dev/null || true
    sudo usermod -s /usr/sbin/nologin "$USERNAME" 2>/dev/null || true
    echo "OK"
    ;;

  delete)
    echo "==> deleting ${USERNAME}"
    sudo rm -f "${SUDOERS_FILE}"
    if getent passwd "$USERNAME" >/dev/null; then
      # Kill any lingering processes so deluser doesn't refuse.
      sudo pkill -9 -u "$USERNAME" 2>/dev/null || true
      sudo deluser --remove-home "$USERNAME" 2>/dev/null || sudo userdel -r "$USERNAME"
    fi
    echo "OK"
    ;;

  pubkey)
    HOME_DIR="$(getent passwd "$USERNAME" | cut -d: -f6 || true)"
    if [[ -n "$HOME_DIR" && -f "${HOME_DIR}/.ssh/authorized_keys" ]]; then
      sudo cat "${HOME_DIR}/.ssh/authorized_keys"
    fi
    ;;

  *)
    echo "unknown action: ${ACTION}" >&2
    exit 64
    ;;
esac
