# Main Process Domain Modules

Status: domain move complete (2026-06); `agent/tools.ts` split complete. This
doc is the CURRENT domain map plus the still-open follow-up splits. The
original file-by-file migration plan/mapping was completed and removed — see
git history of this file if you need it.

## Principles

- Prefer domain folders over technical buckets.
- Keep IPC handlers inside the domain they expose.
- Keep Electron app lifecycle code separate from product capability code.
- Move files first, then split large files after imports and tests are stable.
- Preserve IPC channel names and preload API shape during structural moves.
- Avoid broad `services/`, `utils/`, or top-level `ipc/` folders unless a file
  is genuinely shared across domains.

## Current Structure

Verified against the tree on 2026-07-07; if this drifts, `ls src/main/` wins.

```text
src/main/
  index.ts            # thin entrypoint -> app/bootstrap.ts
  __tests__/          # cross-domain suites incl. import-boundaries + file-size governance

  app/                # bootstrap, window(-manager), protocol, link-policy, logging,
                      # menu, identity, startup-metrics, update-ipc, shell-ipc
  canvas/             # store, sync/ merge policy, storage facade,
                      # persistence/ (paths, atomic JSON, schema, pollution),
                      # broadcast, workspaces, welcome-workspace,
                      # workspace-export-*, nodes/ (ipc, store, tags)
  agent/              # canvas-agent, service, ipc, session-send, session-store,
                      # context-builder, debug-trace, config-scope, default-skills,
                      # codex-sessions, prompt-profile(-ipc), workspace-doc-generator,
                      # workspace-meta, plugin-node-capabilities, dom-selection-context,
                      # window-port + scheduled-port (app-owned capability injection),
                      # model/, mcp/, skills/, tools/ (20+ split tool modules; the
                      # sibling tools.ts is a 2-line re-export shim kept for imports)
  agent-teams/        # service, store, ipc, pty-bridge, canvas-nodes,
                      # canvas-agent-session-adapter (pulse-coder-agent-teams integration)
  artifacts/          # store + ipc (pin-to-canvas logic lives inside ipc.ts)
  webview/            # registry, reader, cdp-session, dom-snapshot-script, ensure-operable
  terminal/           # pty-manager
  files/              # manager, watcher, skill-installer
  generation/         # html-generator + ipc
  runtime/            # control-server, mcp-server, mcp-registration
  plugin-market/      # package readers, config + IPC, install/remove service
  settings/           # experimental-ipc,
                      # built-in-tools-config/-ipc, plugin-manifest-icons
  perf/               # loop-delay (startup/runtime perf counters feed perf/ gates)
```

`src/main/index.ts` stays a narrow entrypoint. It imports a small bootstrap
function and does not own product behavior directly.

## Domain Boundaries

### `app/`

Electron shell ownership: startup/shutdown orchestration, `BrowserWindow`
creation and window manager, custom protocol registration, link/popup policy,
main-process logging and fatal error hooks, menu, app identity, startup
metrics, update IPC. This folder should not know about canvas storage
internals or agent sessions beyond calling domain setup/teardown functions.

### `canvas/`

Workspace canvas ownership: workspace list/load/save IPC, canvas JSON layout
data, v1/v2 storage migration, per-node files, canvas update broadcasting,
workspace export (archive + external files), welcome workspace, knowledge
node records and tags (`nodes/`).

### `agent/`

Canvas agent ownership: chat/session lifecycle, engine integration, prompt
profile and model config (`model/`), MCP config (`mcp/`), agent skills
(`skills/`), workspace context building, agent tools (`tools/` — split into
per-capability modules; `tools.ts` is a compatibility re-export shim), debug
trace support, sending prompts into agent terminal nodes, workspace
documentation generation.

### `agent-teams/`

Multi-agent teams ownership: team service and store, team IPC, PTY bridge for
teammate terminals, canvas node integration, session adapter into the canvas
agent. Integrates `pulse-coder-agent-teams`. `service.ts` (2,569 lines) is the
largest baselined file in the app — split opportunities live here.

### `artifacts/`

Generated and pinned artifact ownership: artifact metadata/versions,
create/update/delete IPC, pinning artifacts to canvas nodes (inside
`ipc.ts`). May depend on canvas storage APIs; canvas must not depend on
artifact internals.

### `webview/`

Embedded page ownership: webview registration, CDP session helpers, DOM /
accessibility-tree / screenshot reads, operability checks. Intentionally
separate from agent tools: the agent consumes webview capabilities, webview
code must not know about agent sessions.

### `terminal/`

PTY ownership: node-pty process lifecycle, terminal session
read/write/kill APIs, terminal IPC handlers. Agent terminal nodes use this
module through exported session helpers.

### `files/`

Local file helper ownership: open/save dialogs, renderer-exposed read/write
helpers, file watching, skill installation file operations.

### `generation/`

Standalone generation ownership: HTML generation and its streaming IPC. May
share model resolution with `agent/model`.

### `runtime/`

Local runtime integration ownership: runtime control HTTP server, local MCP
server, MCP registration. Keeps optional local service endpoints out of the
Electron app shell.

### `plugin-market/`

Agent Plugin package ownership: package reading and validation, plugin
directory/config persistence, native-code policy, skill/MCP discovery,
install/remove mutations, and both legacy Canvas-plugin and market IPC.

### `settings/`

Settings and feature-flag ownership: the shared feature registry resolves
`experimental`, product-owned `stable`, and enabled-user-only `grandfathered`
lifecycles; only the applicable entries surface as Experimental overrides.
This module owns built-in tools config + IPC and plugin manifest icons. Canvas
plugin directory/config state and its IPC live with `plugin-market/`. If a
setting becomes domain-specific, it moves into that domain.

### `perf/`

Main-process performance counters (loop delay) feeding the `perf/` gate
system and `.github/workflows/perf.yml`.

## Open Follow-ups

Phases 1 (domain move) and 4 (agent tools split) of the original plan are
done. Still open:

- **Canvas storage split** — paths, atomic JSON/recovery, schema contracts,
  pollution detection, and interrupted-migration recovery now live under
  `canvas/persistence/` while
  `canvas/storage.ts` preserves the existing caller interface. Remaining
  follow-up: move full-canvas read/write and the v1→v2 state machine behind
  the same facade.
- **Canvas store split** — `canvas/store.ts` still owns IPC registration,
  in-memory workspace state, watcher lifecycle, migration progress
  broadcasting, and startup pollution audit together. Queue merge policy now
  plus snapshot/diff projection, the workspace-level canvas.json watcher, and
  the v2 per-node watcher live under `canvas/sync/`; workspace paths come from
  persistence SSOT.
  Keep public setup/teardown names stable for the remaining split.
- **Agent Teams service split** — `agent-teams/service.ts` still combines plan
  application, task transitions, human gates, PTY/session recovery, and the
  heartbeat loop behind one wide class. Plan normalization/dependency-DAG
  validation live in `agent-teams/planning.ts`, and PTY output protocol parsing
  lives in `agent-teams/output-markers.ts`. Phase/session startup projection is
  owned by `agent-teams/projection.ts`; preserve the IPC-facing use cases while
  moving the remaining state machines into owner-local modules.
- **Main domain dependency ratchet** — the process-layer import check now also
  prevents `agent -> app`, `agent -> scheduled`, `canvas -> agent`,
  `plugin-market -> agent`, `settings -> plugin-market`, and `webview -> agent`. Existing
  cycles involving runtime, scheduled tasks, settings, plugin-market, and
  artifacts remain migration debt; tighten the rule as each reverse edge is
  replaced by an injected capability or an owner-facing interface.

## Import Rules

- Domains may depend on lower-level capability modules through public exports.
- `app/` may call `setup*` and `teardown*` functions but should not import
  domain internals.
- `agent/` may read canvas, artifact, webview, and terminal capabilities.
- `canvas/` should not import `agent/`.
- `webview/` should not import `agent/`.
- `artifacts/` may import canvas storage APIs to pin artifacts, but canvas
  should not import artifact internals.
- Prefer `index.ts` barrel files only where they hide internal substructure and
  do not create circular dependencies. `agent/window-port.ts` is the app-owned
  window capability seam: bootstrap injects `window-manager` there so Agent
  screenshot/webpage tools never import the `app/` composition layer. The
  sibling `scheduled-port.ts` similarly keeps Agent tools/session labels from
  importing Scheduled's runtime, while Scheduled may still use Agent to run a task.

Process directions and the protected Main-domain edges listed above are
enforced by `src/main/__tests__/import-boundaries.test.ts` (run via
`pnpm --filter canvas-workspace test` — there is no CI for it; see
`harness/knowledge/conventions/architecture-boundaries.md`). The remaining
direction table is the migration target, not yet a complete mechanical gate.

## Compatibility Rules

The following must not change during structural refactors:

- Electron preload API exposed through `window.canvasWorkspace`
- IPC channel names
- on-disk canvas data paths and JSON shapes
- model configuration path and format
- workspace session paths
- runtime control file path and local HTTP API
- plugin registration behavior and canvas-agent tool names

Behavioral changes should be separate follow-up commits after a structural
move has passed typecheck and tests.
