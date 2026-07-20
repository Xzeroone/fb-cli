#!/usr/bin/env bash
# One-liner bootstrap:
#   curl -fsSL https://raw.githubusercontent.com/<you>/fb-cli/main/scripts/get-fb.sh | bash
# Or local:
#   bash /path/to/fb-cli/scripts/get-fb.sh
set -euo pipefail

REPO_URL="${FB_REPO_URL:-https://github.com/Xzeroone/fb-cli.git}"
BRANCH="${FB_BRANCH:-main}"
INSTALL_DIR="${FB_INSTALL_DIR:-$HOME/.local/share/fb-cli}"
BIN_DIR="${FB_BIN_DIR:-$HOME/bin}"

green() { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
red() { printf '\033[31m%s\033[0m\n' "$*"; }
info() { printf '→ %s\n' "$*"; }

echo
echo "╔══════════════════════════════════════════╗"
echo "║  fb-cli — one-shot installer             ║"
echo "║  Connect Chrome once → rest is magic     ║"
echo "╚══════════════════════════════════════════╝"
echo

# --- node ---
if ! command -v node >/dev/null 2>&1; then
  red "Node.js >= 20 is required."
  yellow "Install Node, then re-run this script."
  echo "  https://nodejs.org/  or:  sudo apt install nodejs npm"
  exit 1
fi
MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [[ "$MAJOR" -lt 20 ]]; then
  red "Node $(node -v) is too old (need >= 20)"
  exit 1
fi

# --- npm prefix for user-local global (no sudo) ---
if [[ ! -d "$HOME/.npm-global" ]]; then
  mkdir -p "$HOME/.npm-global"
  npm config set prefix "$HOME/.npm-global" 2>/dev/null || true
fi
export PATH="$HOME/.npm-global/bin:$BIN_DIR:$HOME/.local/bin:$PATH"

# --- fetch repo ---
if [[ -n "${FB_LOCAL_ROOT:-}" && -d "${FB_LOCAL_ROOT}/scripts" ]]; then
  ROOT="$FB_LOCAL_ROOT"
  info "using local tree: $ROOT"
elif [[ -f "$(dirname "$0")/install.sh" ]]; then
  ROOT="$(cd "$(dirname "$0")/.." && pwd)"
  info "using adjacent tree: $ROOT"
else
  need_git=1
  if ! command -v git >/dev/null 2>&1; then
    red "git is required to clone fb-cli"
    exit 1
  fi
  info "cloning $REPO_URL → $INSTALL_DIR"
  if [[ -d "$INSTALL_DIR/.git" ]]; then
    git -C "$INSTALL_DIR" fetch --depth 1 origin "$BRANCH" 2>/dev/null || true
    git -C "$INSTALL_DIR" checkout "$BRANCH" 2>/dev/null || true
    git -C "$INSTALL_DIR" pull --ff-only 2>/dev/null || true
  else
    rm -rf "$INSTALL_DIR"
    git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR" \
      || git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
  fi
  ROOT="$INSTALL_DIR"
fi

# --- install opencli + fb ---
info "installing opencli (if needed)..."
if ! command -v opencli >/dev/null 2>&1; then
  npm install -g @jackwener/opencli
fi

info "installing fb binaries + adapters..."
FB_BIN_DIR="$BIN_DIR" bash "$ROOT/scripts/install.sh"

export PATH="$BIN_DIR:$HOME/.npm-global/bin:$PATH"
hash -r 2>/dev/null || true

# --- guided connect ---
if [[ "${FB_SKIP_SETUP:-}" == "1" ]]; then
  green "Install done (FB_SKIP_SETUP=1). Run: fb setup"
  exit 0
fi

echo
green "Packages installed. Starting guided connect…"
echo
exec "$BIN_DIR/fb" setup
