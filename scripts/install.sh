#!/usr/bin/env bash
# Install fb CLI + opencli facebook adapters + optional systemd units
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOME_DIR="${HOME:-$(eval echo ~)}"
BIN_DIR="${FB_BIN_DIR:-$HOME_DIR/bin}"
OPENCLI_CLIS="${HOME_DIR}/.opencli/clis/facebook"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME_DIR/.config}/systemd/user"
STORE="${FB_STORE_DIR:-$HOME_DIR/.local/state/fb}"

red() { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
info() { printf '→ %s\n' "$*"; }

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || { red "Missing required command: $1"; exit 1; }
}

find_opencli() {
  if [[ -n "${OPENCLI_BIN:-}" && -x "$OPENCLI_BIN" ]]; then
    echo "$OPENCLI_BIN"; return
  fi
  if command -v opencli >/dev/null 2>&1; then
    command -v opencli; return
  fi
  for c in \
    "$HOME_DIR/.npm-global/bin/opencli" \
    "$HOME_DIR/.local/bin/opencli" \
    /usr/local/bin/opencli
  do
    [[ -x "$c" ]] && { echo "$c"; return; }
  done
  return 1
}

find_opencli_daemon_js() {
  local opencli
  opencli="$(find_opencli)" || return 1
  # resolve symlink → package
  local real
  real="$(readlink -f "$opencli" 2>/dev/null || realpath "$opencli" 2>/dev/null || echo "$opencli")"
  # typical: .../node_modules/@jackwener/opencli/dist/src/main.js
  local pkg
  pkg="$(cd "$(dirname "$real")/../.." 2>/dev/null && pwd)"
  if [[ -f "$pkg/dist/src/daemon.js" ]]; then
    echo "$pkg/dist/src/daemon.js"; return
  fi
  # npm global layout
  local nm
  nm="$(npm root -g 2>/dev/null || true)"
  if [[ -n "$nm" && -f "$nm/@jackwener/opencli/dist/src/daemon.js" ]]; then
    echo "$nm/@jackwener/opencli/dist/src/daemon.js"; return
  fi
  return 1
}

echo "=========================================="
echo "  fb-cli installer"
echo "=========================================="
echo

# --- prerequisites ---
need_cmd node
need_cmd npm
NODE_BIN="$(command -v node)"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [[ "$NODE_MAJOR" -lt 20 ]]; then
  red "Node.js >= 20 required (found $(node -v))"
  exit 1
fi

if ! find_opencli >/dev/null; then
  yellow "opencli not found — installing @jackwener/opencli globally..."
  npm install -g @jackwener/opencli
fi
OPENCLI="$(find_opencli)" || { red "opencli still not found after install"; exit 1; }
info "opencli: $OPENCLI"

DAEMON_JS="$(find_opencli_daemon_js)" || {
  red "Could not locate opencli daemon.js"
  yellow "Is @jackwener/opencli installed?  npm install -g @jackwener/opencli"
  exit 1
}
info "daemon:  $DAEMON_JS"

# --- bins ---
mkdir -p "$BIN_DIR" "$STORE"/{tmp,keep,cache} "$OPENCLI_CLIS" "$UNIT_DIR"
install -m 755 "$ROOT/bin/fb" "$BIN_DIR/fb"
install -m 755 "$ROOT/bin/fb-service" "$BIN_DIR/fb-service"
install -m 755 "$ROOT/bin/fb-chrome-lean" "$BIN_DIR/fb-chrome-lean"
# portable paths in fb-service
sed -i "s|/home/xzero/bin/fb|$BIN_DIR/fb|g" "$BIN_DIR/fb-service" 2>/dev/null || true
info "installed binaries → $BIN_DIR"

# --- adapters ---
cp -a "$ROOT/adapters/facebook/." "$OPENCLI_CLIS/"
info "installed adapters → $OPENCLI_CLIS"

# --- PATH hint ---
if ! echo ":$PATH:" | grep -q ":$BIN_DIR:"; then
  yellow "Add to PATH (e.g. ~/.bashrc):"
  echo "  export PATH=\"$BIN_DIR:\$PATH\""
fi

# --- systemd (optional) ---
if command -v systemctl >/dev/null 2>&1 && systemctl --user status >/dev/null 2>&1; then
  for u in fb-opencli.service fb-hide.service fb-hide.timer fb-chrome-lean.service; do
    src="$ROOT/systemd/$u"
    dst="$UNIT_DIR/$u"
    sed \
      -e "s|__NODE__|$NODE_BIN|g" \
      -e "s|__OPENCLI_DAEMON__|$DAEMON_JS|g" \
      -e "s|%h|$HOME_DIR|g" \
      "$src" > "$dst"
  done
  # restore %h where systemd supports it for portability on this machine we expanded
  # (user units often prefer absolute paths after install)
  systemctl --user daemon-reload
  info "systemd user units written → $UNIT_DIR"
  yellow "Enable lightweight stack:"
  echo "  systemctl --user enable --now fb-opencli.service fb-hide.timer"
  echo "  # optional always-on Chrome attach:"
  echo "  systemctl --user enable --now fb-chrome-lean.service"
  echo "  # survive logout:"
  echo "  loginctl enable-linger \"\$USER\""
else
  yellow "systemd --user not available — skip services (fb still works when Chrome is open)"
fi

echo
green "Install complete."
echo
echo "========== Auth setup (everyone needs this once) =========="
echo "1. Install OpenCLI Chrome extension:"
echo "   https://chromewebstore.google.com/detail/opencli/ildkmabpimmkaediidaifkhjpohdnifk"
echo "2. Open Chrome and log into facebook.com (normal login / 2FA)."
echo "3. Check bridge:"
echo "   opencli doctor"
echo "4. Check Facebook session:"
echo "   fb whoami"
echo "   # or: fb auth   (opens login if needed)"
echo "5. Optional services:"
echo "   fb-service install   # or systemctl commands above"
echo
echo "If doctor fails: keep Chrome open with the extension enabled."
echo "============================================================"
