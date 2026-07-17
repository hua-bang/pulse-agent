#!/bin/bash
# SessionStart hook — make canvas-workspace typecheck + tests runnable in
# Claude Code on the web, where the egress policy blocks the Electron binary
# download (github.com / npm mirrors return 403) and the container starts
# with no node_modules.
#
# Strategy: install JS deps WITHOUT the native/electron postinstalls that hit
# the blocked hosts, then satisfy the three things the test suite actually
# needs locally:
#   1. Electron's path.txt — the Node-side vitest tests only need
#      require('electron') to resolve to a path string (same as CI); the real
#      binary is never spawned by the tests.
#   2. node-pty compiled against the Node ABI (node headers from nodejs.org
#      ARE allowed) — vitest runs under Node, not Electron.
#   3. Workspace packages that subpath-export from dist (engine / orchestrator
#      / agent-teams) built, so canvas-workspace can resolve them.
set -euo pipefail

# Remote (web) only — local dev should use a normal `pnpm install`.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

echo "[session-start] installing JS deps (scripts ignored)…"
pnpm install --ignore-scripts

echo "[session-start] ensuring Electron path.txt (binary download is policy-blocked here)…"
for d in node_modules/.pnpm/electron@*/node_modules/electron; do
  if [ -d "$d" ] && [ ! -f "$d/path.txt" ]; then
    printf 'electron' > "$d/path.txt"
    echo "[session-start]   wrote $d/path.txt"
  fi
  # Electron >=42 verifies the executable exists at require() time and
  # auto-downloads when missing (blocked here). A zero-byte stub satisfies
  # the existsSync check; tests never spawn the real binary.
  if [ -d "$d" ] && [ ! -e "$d/dist/electron" ]; then
    mkdir -p "$d/dist"
    : > "$d/dist/electron"
    chmod +x "$d/dist/electron"
    echo "[session-start]   stubbed $d/dist/electron"
  fi
done

echo "[session-start] building node-pty native module if missing…"
PTY_DIR="$(ls -d node_modules/.pnpm/node-pty@*/node_modules/node-pty 2>/dev/null | head -1 || true)"
if [ -n "${PTY_DIR:-}" ] && [ ! -f "$PTY_DIR/build/Release/pty.node" ]; then
  GYP="$(ls node_modules/.pnpm/node-gyp@*/node_modules/node-gyp/bin/node-gyp.js 2>/dev/null | head -1 || true)"
  if [ -n "${GYP:-}" ]; then
    ( cd "$PTY_DIR" && node "$CLAUDE_PROJECT_DIR/$GYP" rebuild )
  else
    echo "[session-start]   node-gyp not found; skipping node-pty build"
  fi
fi

echo "[session-start] building workspace JS deps (engine / orchestrator / agent-teams)…"
SKIP_DTS=1 pnpm -r \
  --filter pulse-coder-orchestrator \
  --filter pulse-coder-engine \
  --filter pulse-coder-agent-teams \
  build

echo "[session-start] done."
