#!/bin/bash
# SessionStart hook — make canvas-workspace typecheck + tests runnable in
# Claude Code on the web, where the container starts with no node_modules and
# the egress policy may block the Electron binary download.
#
# Strategy: install JS deps WITHOUT the native/electron postinstalls (they hit
# hosts the policy may refuse), then satisfy the three things the test suite
# actually needs locally:
#   1. Electron's path.txt — the Node-side vitest tests only need
#      require('electron') to resolve to a path string (same as CI); the real
#      binary is never spawned by the tests.
#   2. node-pty compiled against the Node ABI (node headers from nodejs.org
#      ARE allowed) — vitest runs under Node, not Electron.
#   3. Workspace packages that subpath-export from dist (engine / orchestrator
#      / agent-teams) built, so canvas-workspace can resolve them.
#
# The REAL Electron binary is opt-in via PULSE_HARNESS_ELECTRON=1, because only
# driving the app (harness/tools/driver) needs it and it is a ~180MB download
# every session. Whether that download works depends on the environment's
# egress policy, which VARIES: GitHub release assets were 403 when this hook
# was written and reachable on 2026-07-30 (verified by a real headless harness
# launch + screenshot). Treat neither outcome as permanent — try, then fall
# back to the stub; never assume one or the other.
set -euo pipefail

# Remote (web) only — local dev should use a normal `pnpm install`.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

echo "[session-start] installing JS deps (scripts ignored)…"
pnpm install --ignore-scripts

# Opt-in real binary, so this session can drive the app with
# `harness start --headless`. setup:electron is idempotent and falls back to
# the npmmirror CDN itself; a failure here is not fatal — the stub below still
# keeps typecheck and the vitest suites working.
if [ "${PULSE_HARNESS_ELECTRON:-}" = "1" ] || [ "${PULSE_HARNESS_ELECTRON:-}" = "true" ]; then
  echo "[session-start] PULSE_HARNESS_ELECTRON set — installing the real Electron binary (~180MB)…"
  if pnpm --filter canvas-workspace setup:electron; then
    echo "[session-start]   real binary ready — harness start --headless can launch the app"
  else
    echo "[session-start]   download failed — falling back to the path.txt stub (driver unavailable)"
  fi
else
  echo "[session-start] real Electron binary skipped (set PULSE_HARNESS_ELECTRON=1 to drive the app)"
fi

# Stub only what the real install did not provide: install.js writes its own
# path.txt, so an existing file is never overwritten here.
echo "[session-start] ensuring Electron path.txt (stub for tests when no real binary is present)…"
for d in node_modules/.pnpm/electron@*/node_modules/electron; do
  if [ -d "$d" ] && [ ! -f "$d/path.txt" ]; then
    printf 'electron' > "$d/path.txt"
    echo "[session-start]   wrote $d/path.txt"
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
