#!/usr/bin/env bash
# Install fb CLI + opencli facebook adapters + optional systemd units
#
# What this does:
#   1. Verifies Node >= 20 and Chrome are present
#   2. Installs @jackwener/opencli globally if missing
#   3. Copies bin/fb and bin/fb-headless into $BIN_DIR (default ~/bin/)
#   4. Copies adapters/facebook/* into ~/.opencli/clis/facebook/
#   5. Optionally installs the fb-opencli.service systemd user unit
#
# After install, the human must:
#   1. Install the OpenCLI Chrome extension (one click)
#   2. Log into Facebook in Chrome
#   3. Optionally: fb-headless start (for zero-GUI mode)
#   4. Run: fb whoami
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOME_DIR="${HOME:-$(eval echo ~)}"
BIN_DIR="${FB_BIN_DIR:-$HOME_DIR/bin}"
OPENCLI_CLIS="$HOME_DIR/.opencli/clis/facebook"
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
  local real
  real="$(readlink -f "$opencli" 2>/dev/null || realpath "$opencli" 2>/dev/null || echo "$opencli")"
  local pkg
  pkg="$(cd "$(dirname "$real")/../.." 2>/dev/null && pwd)"
  if [[ -f "$pkg/dist/src/daemon.js" ]]; then
    echo "$pkg/dist/src/daemon.js"; return
  fi
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
need_cmd curl
need_cmd node
NODE_BIN="$(command -v node)"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [[ "$NODE_MAJOR" -lt 20 ]]; then
  yellow "Node $NODE_MAJOR found, but >= 20 is required."
  yellow "Trying NodeSource (apt) to get Node 20…"
  if command -v apt-get >/dev/null 2>&1; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1 || {
      red "Could not install Node 20 from NodeSource."
      yellow "Install Node >= 20 manually: https://nodejs.org/"
      exit 1
    }
    apt-get install -y -qq nodejs >/dev/null 2>&1 || {
      red "Node 20 install failed. Try installing manually."
      exit 1
    }
    NODE_BIN="$(command -v node)"
    NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
  elif command -v brew >/dev/null 2>&1; then
    yellow "Install via Homebrew:"
    yellow "  brew install node@20"
    exit 1
  else
    red "Node >= 20 required, but only $NODE_MAJOR found."
    yellow "Install Node >= 20: https://nodejs.org/"
    exit 1
  fi
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
install -m 755 "$ROOT/bin/fb-headless" "$BIN_DIR/fb-headless"
if [[ -f "$ROOT/bin/fb-service" ]]; then
  install -m 755 "$ROOT/bin/fb-service" "$BIN_DIR/fb-service"
fi
info "installed binaries → $BIN_DIR"

# --- adapters ---
cp -a "$ROOT/adapters/facebook/." "$OPENCLI_CLIS/"
info "installed adapters → $OPENCLI_CLIS"

# --- PATH hint ---
if ! echo ":$PATH:" | grep -q ":$BIN_DIR:"; then
  yellow "Add to PATH (e.g. ~/.bashrc):"
  echo "  export PATH=\"$BIN_DIR:\$PATH\""
fi

# --- systemd units (write files; enable via fb-service install) ---
if command -v systemctl >/dev/null 2>&1 && systemctl --user status >/dev/null 2>&1; then
  mkdir -p "$UNIT_DIR"
  if [[ -f "$ROOT/systemd/fb-opencli.service" ]]; then
    sed \
      -e "s|__NODE__|$NODE_BIN|g" \
      -e "s|__OPENCLI_DAEMON__|$DAEMON_JS|g" \
      "$ROOT/systemd/fb-opencli.service" > "$UNIT_DIR/fb-opencli.service"
  fi
  if [[ -f "$ROOT/systemd/fb-headless.service" ]]; then
    cp "$ROOT/systemd/fb-headless.service" "$UNIT_DIR/fb-headless.service"
  fi
  systemctl --user daemon-reload 2>/dev/null || true
  info "systemd units written → $UNIT_DIR"
  yellow "Enable always-on headless stack:"
  echo "  fb-service install"
  echo "  # or: systemctl --user enable --now fb-opencli.service fb-headless.service"
  echo "  loginctl enable-linger \"\$USER\"   # survive logout"
else
  yellow "systemd --user not available — use: fb-headless start"
fi

green "Install complete."
echo
echo "========== One-time setup (everyone needs this) =========="
echo "1. Install the OpenCLI Chrome extension:"
echo "   https://chromewebstore.google.com/detail/opencli/ildkmabpimmkaediidaifkhjpohdnifk"
echo "2. Open Chrome and log into facebook.com (normal login / 2FA)."
echo "3. Start headless backend (or use fb-service install):"
echo "   fb-headless start"
echo "4. Verify:"
echo "   opencli doctor && fb whoami"
echo
echo "========== Headless ops =========="
echo "   fb-headless start|stop|restart|status|logs|reset"
echo "   fb-service install   # always-on opencli + headless"
echo "============================================================="
