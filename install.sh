#!/usr/bin/env bash
#
# opencode-compaction-plugin installer
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/BaconDroid/opencode-compaction-plugin/master/install.sh | bash
#   # or from a local clone:
#   ./install.sh
#   ./install.sh /path/to/project
#
set -euo pipefail

# --- Colors ---
GREEN='\033[0;32m'
CYAN='\033[0;36m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

info() { echo -e "${CYAN}[info]${NC}  $*"; }
ok() { echo -e "${GREEN}[ok]${NC}    $*"; }
warn() { echo -e "${YELLOW}[warn]${NC}  $*"; }
error() {
	echo -e "${RED}[error]${NC} $*" >&2
	exit 1
}

# --- Resolve target project directory ---
TARGET_DIR="${1:-.}"
TARGET_DIR="$(cd "$TARGET_DIR" && pwd)"

PLUGIN_BASE="${TARGET_DIR}/.opencode/plugins"
PLUGIN_DIR="${PLUGIN_BASE}/compaction"
ENTRY_FILE="${PLUGIN_BASE}/compaction.ts"
TMP_DIR=""

cleanup() {
	if [[ -n "$TMP_DIR" && -d "$TMP_DIR" ]]; then
		rm -rf "$TMP_DIR"
	fi
}
trap cleanup EXIT

info "Installing opencode-compaction-plugin into ${TARGET_DIR}"

# --- Locate source files ---
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SRC_DIR=""

# Check if we're running from the repo
if [[ -f "${SCRIPT_DIR}/src/index.ts" ]]; then
	SRC_DIR="${SCRIPT_DIR}/src"
else
	# Download from GitHub
	info "Downloading from GitHub..."
	TMP_DIR="$(mktemp -d)"
	git clone --depth 1 https://github.com/BaconDroid/opencode-compaction-plugin.git "$TMP_DIR/repo" 2>/dev/null ||
		error "Failed to clone repository"
	SRC_DIR="${TMP_DIR}/repo/src"
fi

[[ -d "$SRC_DIR" ]] || error "Source directory not found"

# --- Create plugin directory ---
mkdir -p "$PLUGIN_DIR"

# --- Copy the source tree (preserve core/, config/, opencode/) ---
if ! find "$SRC_DIR" -name '*.ts' -print -quit | grep -q .; then
	error "No TypeScript sources found in ${SRC_DIR}"
fi
cp -R "${SRC_DIR}/." "${PLUGIN_DIR}/"

# --- Create entry point barrel file ---
# OpenCode scans .opencode/plugins/*.ts (not subdirs)
# so we need a barrel file at the root that re-exports
cat >"$ENTRY_FILE" <<'BARREL'
/** opencode-compaction-plugin entry point */
export { CompactionPlugin, default } from "./compaction/index.ts"
BARREL

# --- Verify ---
SRC_COUNT="$(find "$SRC_DIR" -name '*.ts' | wc -l | tr -d ' ')"
FILES_COUNT="$(find "$PLUGIN_DIR" -name '*.ts' | wc -l | tr -d ' ')"
if [[ "$FILES_COUNT" -lt "$SRC_COUNT" ]]; then
	error "Expected ${SRC_COUNT} files, found ${FILES_COUNT}"
fi

if [[ ! -f "$ENTRY_FILE" ]]; then
	error "Entry point barrel file was not created"
fi

ok "Plugin installed:"
ok "  ${PLUGIN_DIR}/ (${FILES_COUNT} TypeScript files)"
ok "  ${ENTRY_FILE} (entry point)"

# --- Check if opencode.json exists and suggest plugin entry ---
if [[ -f "${TARGET_DIR}/opencode.json" ]]; then
	if grep -q "opencode-compaction-plugin" "${TARGET_DIR}/opencode.json" 2>/dev/null; then
		ok "opencode.json already references the plugin"
	else
		warn "For npm-style loading, add to opencode.json:"
		echo ''
		echo '  {'
		echo '    "plugin": ["opencode-compaction-plugin"]'
		echo '  }'
		echo ''
		info "Local plugin is already active — no config change needed."
	fi
else
	info "No opencode.json found. The local plugin will be auto-loaded from .opencode/plugins/compaction.ts"
fi

echo ''
ok "Done! OpenCode will use enhanced 11-section compaction on next session."
