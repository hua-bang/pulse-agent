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
  __tests__/          # allowlisted cross-domain/process/governance suites only

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
                      # capability/window/scheduled ports (app-owned injection),
                      # mcp/, skills/, tools/ (20+ split tool modules; the
                      # sibling tools.ts is a 2-line re-export shim kept for imports)
  agent-teams/        # service, store, ipc, pty-bridge, canvas-nodes,
                      # canvas-agent-session-adapter (pulse-coder-agent-teams integration)
  artifacts/          # store + ipc (pin-to-canvas logic lives inside ipc.ts)
  webview/            # registry, reader, cdp-session, dom-snapshot-script, ensure-operable
  terminal/           # pty-manager
  files/              # manager, watcher, skill-installer
  generation/         # html-generator + ipc
  models/             # provider/model config, resolution, secret storage + IPC
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
profile, MCP config (`mcp/`), agent skills
(`skills/`), workspace context building, agent tools (`tools/` — split into
per-capability modules; `tools.ts` is a compatibility re-export shim), debug
trace support, sending prompts into agent terminal nodes, workspace
documentation generation.

### `agent-teams/`

Multi-agent teams ownership: team service and store, team IPC, PTY bridge for
teammate terminals, canvas node integration, session adapter into the canvas
agent. Integrates `pulse-coder-agent-teams`. `service.ts` is down from 2,569
to 1,849 lines; the remaining transition/watchdog state machines are the next
split opportunities.

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

Standalone generation ownership: HTML generation and its streaming IPC. Uses
the shared Main `models/` domain for provider resolution.

### `models/`

Shared Main-process model ownership: provider/model configuration, API-key
storage, environment resolution, provider model discovery, and the
`canvas-model:*` IPC surface. Agent and Generation consume this domain.

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
  owned by `agent-teams/projection.ts`, while command execution and bounded
  output capture live in `agent-teams/verification.ts`. Session-exit matching
  and queued-launch grace decisions live in `agent-teams/recovery-policy.ts`;
  Team Lead briefing/execution protocol text lives in `agent-teams/prompts.ts`.
  Agent/task/gate name and fallback rules live in `agent-teams/resolution.ts`.
  Working-directory inference lives in `agent-teams/working-directory.ts`.
  PTY-hot-path node→agent lookup/cache lives in `agent-teams/agent-node-resolver.ts`.
  Debounced runtime-event→canvas broadcasts live in `agent-teams/team-event-broadcaster.ts`.
  Heartbeat workspace discovery and its disk-scan cache live in `agent-teams/workspace-discovery.ts`.
  Legacy persisted-state repair ordering and transitions live in `agent-teams/state-repairs.ts`.
  Preserve the IPC-facing use cases while moving the remaining state machines
  into owner-local modules.
- **Main domain dependency ratchet** — the process-layer import check now also
  prevents `agent -> app`, `agent -> runtime`, `agent -> scheduled`,
  `artifacts -> agent`, `canvas -> agent`, `default-browser -> app`,
  `generation -> agent`, `plugin-market -> agent`, `runtime -> app`,
  `settings -> plugin-market`, and `webview -> agent`. Tighten remaining
  reverse edges as each one is replaced by an injected capability or an
  owner-facing interface.

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
`harness/knowledge/conventions/architecture-boundaries.md`). The same suite
also rejects every cycle in the complete `src/main/**` top-level domain graph;
plugin adapters under `src/plugins/main/**` remain a separate extension surface.

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

## Document transactions and artifact pinning

- External canvas-store synchronization must treat edges as first-class state:
  watcher events carry edge ids, renderer reloads must accept edge-only events,
  and stale saves merge edges by `updatedAt` without dropping unsaved local
  edges. Guards: `src/main/canvas/__tests__/store-merge.test.ts` and
  `src/renderer/src/modules/canvas/document/__tests__/externalMerge.test.ts`.

- Cross-mindmap topic transfers are canvas-level atomic transactions: rekey
  every moved topic subtree, update both maps in one history snapshot, and
  degrade bound edges in that same snapshot when a whole source map is removed.
  Topic components own only drag intent; `useCanvasDocument` owns mutation and undo.

`src/main/artifacts/ipc.ts` — pin refuses sentinel (`__*`) scopes, dedupes against a live mirror, list/get lazily clear a stale `pinnedNodeId`, delete removes the canvas mirror node; `artifact:list-all` (metadata-only summaries) skips `__*` dirs EXCEPT `__global_chat__` (session-store sentinel rule — a blanket skip silently hides global artifacts). Library drawer = renamed ReferenceDrawer: Pinned entries persist per workspace via the `references` IPC domain (`src/main/references/`, `src/shared/references.ts`, hydrate/save in `Workbench/useReferenceEntries.ts`); Artifacts source tab is `ReferenceDrawer/ArtifactsPicker.tsx` (cross-scope pin disabled by design). Tests: `src/main/artifacts/__tests__/pin-lifecycle.test.ts`

## Main and shared entry reference

- `src/main/index.ts`: thin Electron main entrypoint.
- `src/main/app/bootstrap.ts`: startup wiring for IPC, canvas storage, agent,
  teams, plugins, runtime-control, window creation, and teardown.
- `src/preload/index.ts`: exposes `window.canvasWorkspace` and assembles bridge
  APIs.
- `src/shared/canvas.ts`: canonical canvas node, edge, reference, and workspace
  node contracts.
- `src/main/dock/`: right-dock tab support in main — `tab-store.ts` (tab
  mirror), `tab-actions.ts` (tab-activation pushes), `history-store.ts`
  (browsing history). Detail: `harness/knowledge/dock-browser.md`.
- `src/main/webview/lifecycle.ts`: shared Canvas-node and right-dock webview
  lifecycle policy. Real-time Feishu/Lark hosts remain eligible for the 1fps
  paint throttle but are exempt from L2 freeze and therefore L3 discard; match
  the guest's current URL, not the node/tab's originally saved URL.
- `src/main/canvas/store.ts`: workspace manifest/store IPC, watchers, export,
  import, and migration hooks.
- `src/main/canvas/storage.ts`: atomic JSON I/O, v2 split storage, migration,
  recovery, and pollution detection.
- `src/main/agent/`: Canvas Agent service, session store, prompt config, tools,
  and chat IPC; shared provider/model config lives in `src/main/models/`.
- `src/main/agent-teams/`: agent-team service, store, IPC, PTY bridge, and
  canvas node integration.
- `src/main/runtime/control-server.ts`: loopback runtime server used by live
  `pulse-canvas` commands.
- `src/plugins/main/`, `src/plugins/renderer/`, `src/plugins/types.ts`: Canvas
  plugin registries and shared plugin contracts.
- `harness/`: workspace harness container — `knowledge/` (conventions + maps),
  `tools/driver/` (Electron launch, CDP, screenshot, input, logs, cleanup),
  `skills/` (agent procedures), `validate/` (check bindings).
