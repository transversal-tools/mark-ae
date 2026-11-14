#!/bin/bash
# Mark - macOS installer. Run once from this folder, as your normal user:
#
#   ./install-mac.sh
#
# Does: checks Node, turns on CEP debug mode for After Effects (Mark is not a
# signed .zxp), links this folder into AE's extensions as "Mark", and registers
# the Mark MCP server with Claude Code if it is installed. Safe to run again.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER="$REPO/mcp-server/server.js"
EXT_DIR="$HOME/Library/Application Support/Adobe/CEP/extensions"
LINK="$EXT_DIR/Mark"

step() { printf '\n\033[36m== %s\033[0m\n' "$1"; }
ok()   { printf '   \033[32mOK\033[0m  %s\n' "$1"; }
warn() { printf '   \033[33m!!\033[0m  %s\n' "$1"; }

step 'Node'
NODE="$(command -v node || true)"
if [ -z "$NODE" ]; then
    warn 'Node.js 18 or newer is required. Install it (https://nodejs.org or "brew install node"), then run this again.'
    exit 1
fi
ok "Node $("$NODE" --version) at $NODE"

step 'CEP debug mode (lets AE load Mark, which is not a signed .zxp)'
for v in 9 10 11 12 13; do
    defaults write "com.adobe.CSXS.$v" PlayerDebugMode 1
done
ok 'PlayerDebugMode = 1 for CSXS 9 to 13'

step 'Mark panel'
mkdir -p "$EXT_DIR"
if [ -L "$LINK" ]; then
    rm "$LINK"
elif [ -e "$LINK" ]; then
    warn "$LINK already exists and is a real folder. Rename or remove it, then run this again."
    exit 1
fi
ln -s "$REPO" "$LINK"
xattr -dr com.apple.quarantine "$REPO" 2>/dev/null || true
chmod +x "$SERVER"
ok "Window > Extensions > Mark  ->  $REPO"

step 'Claude Code: Mark MCP server'
if command -v claude >/dev/null 2>&1; then
    claude mcp remove mark -s user >/dev/null 2>&1 || true
    claude mcp add -s user mark -- "$NODE" "$SERVER"
    ok "mark -> $SERVER"
else
    warn 'Claude Code not found, skipped. The Chat tab needs it too. Install it, run "claude" once to sign in, then run this again:'
    echo '       curl -fsSL https://claude.ai/install.sh | bash'
fi

step 'Codex (optional)'
echo '   Add this to ~/.codex/config.toml:'
echo
echo '   [mcp_servers.mark]'
echo "   command = \"$NODE\""
echo "   args = [\"$SERVER\"]"

printf '\n\033[36mDone. Restart After Effects and open Window > Extensions > Mark.\033[0m\n'
