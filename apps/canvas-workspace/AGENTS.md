# AGENTS.md - apps/canvas-workspace

> Local entry for `apps/canvas-workspace`.
> Repository harness entry: `../../harness/README.md`.
> `CLAUDE.md` is a thin import shell of this file — edit here, never both.

## Module Positioning

`canvas-workspace` owns the Pulse Canvas Electron workbench: the desktop shell,
React renderer, preload bridge, canvas persistence and migration, Canvas Agent
chat, agent-team flows, plugin loading, embedded webviews, terminal/agent PTYs,
artifacts, settings, local runtime-control server, and app-specific harness.

This is an active pnpm app workspace. It consumes `pulse-coder-engine` and
`pulse-coder-agent-teams`, interoperates with `@pulse-coder/canvas-cli` through
the canvas store and runtime-control server, and hosts external node plugins
such as `@pulse-canvas/nodes` through manifests and plugin registries.

Keep this file as the local router. Put durable implementation detail in
existing workspace docs or tests. Add new workspace docs only when a behavior
or operating runbook needs a durable source of truth.

**Local harness layout** — `harness/` is this workspace's repo-harness
container, aligned with `packages/engine/harness/` (migrated 2026-07-07;
before that the directory held only the Electron driver):
- `harness/knowledge/` — conventions, main domain map, renderer surfaces,
  plugin node contract, security posture, known defects (moved from `docs/`;
  `docs/` now keeps only project records like perf analyses and roadmaps).
- `harness/tools/driver/` — the headless-Electron driver (launch profiles,
  CDP, screenshots, logs). It is BOTH the repo-harness Tool face and a
  product-operation CLI; `pnpm --filter canvas-workspace harness <cmd>`
  still points at it.
- `harness/tools/describe-canvas.mjs` — static structure snapshot: agent-tool
  registry, IPC handle↔invoke contract diff, node-type union↔factory
  sync, and app↔canvas-cli parity (NodeType union subset + storage
  schema-version constants). Run before touching any of those registries;
  exits non-zero on a broken invoke, union/factory drift, a CLI-only node
  type, an unallowlisted app-only type, or a schema-version mismatch.
- `harness/tools/ui-showcase/` — Playwright screenshot baseline for
  `components/ui/` (the blessed design-system set): a plain-React vite page
  (zero Electron/preload imports) mounting every `ui/` piece in its
  meaningful variants/states, plus the one Playwright spec that captures
  and compares against committed baselines. `pnpm run visual` /
  `visual:update` from this package; Linux-rendered baselines only (fonts
  differ per OS) — see `harness/tools/ui-showcase/README.md`. Built as the
  prerequisite for `docs/ui-reuse-burndown.md`'s Batch C3.
- `harness/skills/` — SKILL.md procedures for coding agents operating this
  app: `canvas-harness`, `canvas-onboard-harness` (drive the real app),
  `validate-canvas-change` (choose quick/standard/release evidence),
  `add-canvas-node`, `add-agent-tool`, `add-builtin-main-plugin`,
  `extend-blessed-ui`, `add-ipc-surface` (safe-change procedures for the
  five recurring extension shapes).
- `harness/spec/` — decision-pending intent, currently **empty** (the
  success state). Two entries completed their full lifecycle: UI-reuse
  (2026-07-07: decided → mechanized as `ui-reuse-governance.test.ts` +
  `components/ui/` → deleted) and node-extension-path (2026-07-08: decided
  plugin-default → encoded in the `add-canvas-node` skill + this file's
  node-type constraint above → deleted). Surface definition lives in
  `packages/engine/harness/spec/README.md`.
- `harness/validate/validation.yaml` — path→check bindings for the repo runner.

**"skills" disambiguation** — `harness/skills/*/SKILL.md` are procedures for
CODING agents working on this app; `src/main/agent/skills/` is the PRODUCT
runtime-skills feature of the in-app Canvas Agent; `files/skill-installer.ts`
deploys the external-agent `pulse-canvas` CLI + bundled skills. Do not mix them.

## Knowledge Navigation

| Task | Read |
|---|---|
| Repository harness and root validation | `../../harness/README.md`, `../../harness/validate/validation.yaml` |
| App overview | `README.md` |
| Drive the real app (launch/CDP/screenshot) | `harness/tools/driver/README.md`, `harness/skills/canvas-harness/SKILL.md`, `harness/skills/canvas-onboard-harness/SKILL.md`; what "correct" looks like: `harness/knowledge/renderer-surfaces.md` |
| Security posture, agent execution reach, disk/config surfaces | `harness/knowledge/security-posture.md` |
| Confirmed-but-unfixed defects | `harness/knowledge/known-defects.md` |
| Main/renderer/preload boundaries | `harness/knowledge/conventions/README.md`, `harness/knowledge/conventions/architecture-boundaries.md` |
| Renderer conventions | `harness/knowledge/conventions/frontend.md` |
| Main-process conventions | `harness/knowledge/conventions/backend.md` |
| PATH for anything the app spawns | `src/main/shell-path.ts` — a GUI launch inherits a stripped PATH, and every child (agent `bash`, which the engine spawns with NO `env`, MCP stdio servers, the bundled CLI) takes `process.env` verbatim, so a missing binary surfaces as a bare "command not found". Repaired once in `bootstrap.ts` before any spawn: `augmentProcessPath()` (sync, well-known per-user bin dirs incl. `~/.pulse-coder/bin`) then a best-effort `applyLoginShellPath()` (async, timeout-bounded `$SHELL -ilc`, only ever widens). PTY env shares the same bin-dir list — do not fork a second copy. Tests: `src/main/__tests__/shell-path.test.ts` |
| Main domain map | `harness/knowledge/main-domain-modules.md`, `src/main/index.ts`, `src/main/app/bootstrap.ts` |
| Renderer routes and full-app surfaces | `harness/knowledge/renderer-surfaces.md`, `src/renderer/src/App.tsx`, `src/renderer/src/components/Workbench/`, `src/renderer/src/components/RightDock/` |
| Cross-process API bridge | `src/preload/index.ts`, `src/preload/bridge/`, `src/renderer/src/types.ts`, `src/shared/` |
| Add a capability spanning main + preload + renderer | `harness/skills/add-ipc-surface/SKILL.md` (ordered procedure — contract placement, streaming pattern, bootstrap wire, lockstep rule) |
| Canvas node/edge schema | `src/shared/canvas.ts` |
| Add a new canvas node capability | `harness/skills/add-canvas-node/SKILL.md` (ordered procedure — plugin is the default path, host type is the exception); background: `harness/knowledge/plugin-node-mf2.md` (plugin path), `src/shared/canvas.ts`, `src/renderer/src/utils/nodeFactory.ts`, `src/renderer/src/components/CanvasNodeView/` (host-type touch points) |
| Current registries (agent tools / IPC pairs / node types) | run `node harness/tools/describe-canvas.mjs` (from this dir; `--json` for machines) |
| Visual-regression baseline for ui/ pieces | `harness/tools/ui-showcase/README.md`; run `pnpm run visual` / `pnpm run visual:update` |
| Canvas persistence and migration | `src/main/canvas/store.ts`, `src/main/canvas/storage.ts`, `src/main/canvas/nodes/` (NB: `nodes/` here = knowledge-node records + tags, NOT node types) |
| Canvas Agent and tools | `src/main/agent/`, `src/main/agent/tools/`, `src/renderer/src/components/chat/` |
| Multi-role chat (@角色 group chat + relay) | `src/shared/agent-roles.ts` (role contract, `@[role:<id>\|<name>]` marker, speaker-label SSOT, `RoleTurn*Event` stream payloads), `src/main/agent/roles-store.ts` + `agent-roles-ipc.ts` (global library at `~/.pulse-coder/canvas/roles.json`, `agent-roles:*`), `src/main/agent/role-turn.ts` (persona section + BOTH model-history label injection points — live push and session reload MUST stay in lockstep — plus the relay boundary policy `shouldRunRelaySegment`, all pinned by `src/main/agent/__tests__/role-turn.test.ts`). Routing parses ALL role markers from the message text main-side (order-preserving, id-deduped): one → single persona turn, several → a RELAY where each role runs as its own engine segment against the shared history, so segment N+1 reads segment N's labeled reply; edit/regenerate replays re-run the whole turn with zero extra plumbing. Stored content stays clean (【name】 labels exist only on the model-facing copy) and speaker name/color are per-message snapshots that survive role edits/deletes. Stream protocol: every turn emits `role-turn-start/end:{sessionId}` (total=1 for single speakers); `canvas-agent:stop-relay` is the graceful boundary stop (current speaker finishes, queued ones are skipped) — the composer abort stays the hard stop. Agent@agent handoff (P2, opt-in): library switch `allowRoleHandoff` lives in roles.json settings (Settings → Chat Roles card, `agent-roles:settings-get/save`, default OFF, role writes preserve it). When ON, each ROLE segment's reply is scanned for plain-text `@RoleName` (`findRoleNameMentions`: name-based because models never emit internal markers; longest-name-first with span consumption, ASCII case-insensitive) and matches are appended to the SAME turn's queue — policy in `resolveHandoffRoles`: self dropped, already-queued deduped, roles that SPOKE may re-enter, and growth (never the user-named speakers) is capped by `ROLE_RELAY_MAX_SEGMENTS`=6. Appended queue refs carry `namedBy` (RelayBar dashed underline + "由 X 点名" tooltip; the bar can appear mid-turn when a single-role turn grows — pinned in `relayTurnHandlers.test.ts`); default-assistant segments never hand off, and a pending graceful stop freezes the queue. Renderer: `role` mention group, speaker badge in `ChatMessage.tsx`, per-segment bubbles + completion policy in `hooks/relayTurnHandlers.ts` (tested), `RelayBar.tsx` progress strip, `RolesSettings.tsx` behind the Settings `chat-roles` section. Role accents everywhere come from one renderer cache — `hooks/roleMentionItems.ts` (popup entries + id→color map, 5s TTL, `useRoleColors()`, invalidated by Settings save/delete) — and chips recolor by overriding the `--role-accent*` tokens inline per chip (`utils/mentions.ts`), so unknown/deleted role ids fall back to the violet class tokens. Chat entry: `chat_role_list`/`chat_role_save` in `src/main/agent/tools/roles.ts` — app-level, registered UNWRAPPED on both tool factories, `defer_loading`, no delete (scheduled-tools posture); a tool-created role is @-able within the mention popup's 5s roles-cache TTL. |
| Agent long-term memory (global + per-workspace) | `src/main/agent/memory-store.ts` (store + prompt injection; explicit-save-only by design), `src/main/agent/tools/memory.ts` (`memory_save` eager; `memory_list`/`memory_forget`/`memory_adopt` deferred — `memory_adopt` is the sole cross-workspace write path, reserved for user-confirmed candidates from the `memory-review` default skill), tests in `src/main/agent/__tests__/memory-store.test.ts` + `tools-graph.test.ts` |
| Artifact runtime capabilities (page → host actions) | `src/shared/artifact-capabilities.ts` (trust model + contract), `src/main/artifacts/capability-ipc.ts` (`artifact-capability:invoke`, main-side authoritative validation), `src/renderer/src/components/artifacts/capabilityBridge.ts` + `ArtifactTabView` (host-authored bridge script, postMessage relay, audit toast). Capabilities are declared on the artifact RECORD by creating code (never by the page), gated on a real user gesture in the bridge, and every write surfaces a toast. Current capabilities: `memory.adopt`, `skill.save` (both = the user's click IS the confirmation). Tests: `src/main/artifacts/__tests__/capability-invoke.test.ts` |
| Artifact pin lifecycle + Library drawer | `src/main/artifacts/ipc.ts` — pin refuses sentinel (`__*`) scopes, dedupes against a live mirror, list/get lazily clear a stale `pinnedNodeId`, delete removes the canvas mirror node; `artifact:list-all` (metadata-only summaries) skips `__*` dirs EXCEPT `__global_chat__` (session-store sentinel rule — a blanket skip silently hides global artifacts). Library drawer = renamed ReferenceDrawer: Pinned entries persist per workspace via the `references` IPC domain (`src/main/references/`, `src/shared/references.ts`, hydrate/save in `Workbench/useReferenceEntries.ts`); Artifacts source tab is `ReferenceDrawer/ArtifactsPicker.tsx` (cross-scope pin disabled by design). Tests: `src/main/artifacts/__tests__/pin-lifecycle.test.ts` |
| Headless (background) agent runs | `src/main/agent/headless-run.ts` (one-shot bounded Engine run: no session store, `builtInTools:{}` = structurally read-only, wall-clock timeout, never throws), `src/main/agent/memory-report.ts` (first consumer — cross-workspace memory report as self-contained HTML; adoption stays interactive-only; scheduled entry archives to `<memory>/reports/` with rolling retention AND publishes a `__global_chat__`-scoped artifact, surfaced by an OS notification whose click pushes `dock:open-artifact`). Tests: `src/main/agent/__tests__/headless-run.test.ts` |
| Scheduled tasks | `src/main/scheduled/` — stable top-level Scheduled surface with persisted user-defined tasks, an exact next-due main-process timer backed by a 30-minute heartbeat, startup/resume catch-up, manual run-now, and one isolated durable Agent chat scope per task. Cadence is the `ScheduledSchedule` union in `src/shared/scheduled.ts`: `interval` (relative, minimum 30 minutes, anchored at create/enable/last-attempt) or `daily`/`weekly` at a LOCAL wall-clock `HH:mm`. `computeNextRunAt` is the single next-run authority for all three kinds — use local `Date` field arithmetic there, never fixed millisecond offsets, so absolute slots survive DST. A slot missed while the app was closed runs ONCE on catch-up and then realigns to the next slot (never one run per missed slot); failed attempts consume the current slot rather than hot-looping. Pre-`schedule` records carrying `intervalMinutes` are lifted into the union on read (`migratePersistedTask`); the field is gone from the live contract. The built-in weekly memory-report prompt is seeded idempotently as a disabled Scheduled task on `weekly` Monday 09:00 local; it is no longer an Experimental entry. Seeding is one-shot by design — an install that already carries the task keeps its stored schedule, so the Monday default reaches new installs only. A finished attempt — success AND failure — is announced by `announceRunFinished` (`scheduled/runtime.ts`) as a `scheduled:run-finished` push that `useScheduledRunToasts` turns into a STICKY toast (`autoCloseMs: 0`); its action routes to `/chat?scheduledTask=<id>`, i.e. the task's own conversation inside the AI Chat rail. Each task's chat is a session STORE (`__scheduled__-<taskId>`), listed in that rail beside workspaces and global chat — `src/shared/agent-chat.ts` owns the store-id vocabulary (`scopeSessionStoreId`, `scheduledTaskIdFromStoreId`, `isListableSessionStore`), and every consumer that maps a listed session back to a scope MUST go through it: a sentinel store id treated as a workspace id activates an agent against a workspace that does not exist. `__`-prefixed stores are allowlisted, never blanket-skipped (that is what hid scheduled chats from the rail). Deliberately in-app only: OS `Notification` was tried and removed (Focus modes, missing notification daemons, unsigned dev builds, and Windows-without-AppUserModelID all drop it silently, and it needed a retained-reference dance to survive GC), so do not reintroduce a second channel — `scheduled-run-notify.test.ts` asserts none is raised. A run finishes while nobody is watching, so the toast must never expire on a timer. IPC contract: `src/shared/scheduled.ts` → `src/preload/bridge/scheduled.ts` → renderer `components/Scheduled/`; list rows are presentational — every action is an explicit button, and the time picker is hour/minute `ui/Select`s, never a native `<input type="time">`. Chat entry: `scheduled_task_list`/`_create`/`_update` in `src/main/agent/tools/scheduled.ts` — app-level, so registered UNWRAPPED on both tool factories, all `defer_loading`, no delete (see `harness/knowledge/security-posture.md` for why); it dynamic-imports `scheduled/runtime` to avoid the tools→runtime→agent-service module cycle. Tests: `src/shared/scheduled.test.ts` (schedule validation + next-run math), `src/main/__tests__/scheduled-task-service.test.ts`, `src/main/__tests__/scheduled-run-notify.test.ts` (completion push, success AND failure, and no OS notification), `components/Scheduled/__tests__/useScheduledRunToasts.test.tsx` (sticky toast), `src/main/agent/__tests__/scheduled-tools.test.ts`, `components/Scheduled/__tests__/TaskEditorModal.test.tsx` + `ScheduledPage.test.tsx`, plus scheduled-scope coverage in `src/main/agent/__tests__/service-history.test.ts`. |
| Add a capability shared by Tool + CLI | `../../harness/skills/add-canvas-capability/SKILL.md`; use `harness/skills/add-agent-tool/SKILL.md` for the optional task-specific Canvas Agent adapter |
| Agent teams | `src/main/agent-teams/`, `src/renderer/src/components/AgentTeamFrame/` |
| Runtime-control server | `src/main/runtime/control-server.ts` |
| Plugin node contract | `harness/knowledge/plugin-node-mf2.md`, `src/plugins/types.ts`, `src/plugins/main/`, `src/plugins/renderer/`, `src/plugins/mock-node/` |
| Project records (perf analyses, roadmaps) | `docs/` |
| Channel plugin | `src/plugins/main/channel/README.md`, `src/plugins/main/channel/` |
| Boundary, file-size, and UI-reuse gates | `src/main/__tests__/import-boundaries.test.ts`, `src/main/__tests__/file-size-governance.test.ts`, `src/main/__tests__/ui-reuse-governance.test.ts` |
| Storage/plugin/runtime tests | `src/main/__tests__/canvas-storage.test.ts`, `src/plugins/main/__tests__/registry.test.ts`, `src/main/runtime/__tests__/control-server.test.ts` |
| Local validation | `harness/validate/validation.yaml` |
| Choose proportionate local validation | `harness/skills/validate-canvas-change/SKILL.md` |

## Local Constraints

- Renderer code reaches privileged behavior only through the typed
  `window.canvasWorkspace` preload API. Do not import Electron, Node, `src/main`,
  or `src/preload` from renderer code.
- Cross-process contracts should move toward `src/shared/`. Existing preload
  imports from `src/renderer/src/types.ts` are allowlisted migration debt; do
  not add new preload-to-renderer imports.
- Keep main-process code in domain folders under `src/main/`; preserve
  IPC channel names and preload API shape when refactoring.
- Agent tool names, schemas, and descriptions under `src/main/agent/tools/`
  ship in the main bundle. Keep descriptions concise and run the bundle gate
  for tool-surface growth; repeated usage prose belongs in the system prompt.
- Follow file-size governance: new production `.ts`/`.tsx` files must stay at
  or below 500 lines, and existing over-500 baseline files must not grow.
- Runtime data belongs under user locations such as `~/.pulse-coder/canvas/`,
  `~/.pulse-coder/canvas-runtime/`, and model/settings files. Do not write user
  runtime state into the repository.
- Packaged builds bundle the existing `@pulse-coder/canvas-cli` under Electron
  resources. On first launch and after app updates, the app idempotently
  installs its versioned files under `~/.pulse-coder/tooling/pulse-canvas/`, a
  no-system-Node wrapper under `~/.pulse-coder/bin/`, and all bundled skills
  into Pulse/Codex/Claude global skill dirs. Keep startup, Settings repair, and
  experimental-trigger installs on the shared `AgentToolingManager`; production
  installation must never depend on a source checkout, `pnpm`, or global link.
  Treat the CLI + skills as one compatibility bundle. The persisted update
  policy under the tooling root defaults to following app updates; `ask` and
  `pinned` retain the active bundle until an explicit Settings update, while
  damage repair of that active bundle remains automatic from its fingerprinted
  local payload cache. Runtime payload directories are fingerprint-qualified
  and immutable across updates so a same-semver replacement cannot overwrite
  the CLI currently referenced by the launcher. Bundle activation is
  failure-atomic: a skill, launcher, or active-state write failure must restore
  the previously active set. Settings may offer an explicit shell-PATH setup for
  zsh/bash/fish; it appends one marked `~/.pulse-coder/bin` entry only after a
  user click, never during automatic install/update.
- `harness/tools/driver/` launches the real Electron app. Use `temp`, `demo`,
  or `clone` profiles by default; use `real --allow-real-writes` only after
  explicit user intent because it can mutate real Pulse Canvas data.
  Reopening `demo` without `--reset` preserves its existing manifest and
  imported workspaces; fixture reseeding is a reset operation.
- The app owns v2 canvas storage migration, PTY sessions, runtime-control
  endpoints, plugin activation, and UI-visible data recovery. The CLI adapts to
  those contracts but does not own them.
- External canvas-store synchronization must treat edges as first-class state:
  watcher events carry edge ids, renderer reloads must accept edge-only events,
  and stale saves merge edges by `updatedAt` without dropping unsaved local
  edges. Guards: `src/main/__tests__/canvas-store-merge.test.ts` and
  `src/renderer/src/hooks/useNodes.external-update.test.ts`.
- Live-app capabilities belong under `src/main/runtime/capabilities/`; stable
  Canvas Agent tools may adapt to them without changing their public names or
  payloads. External `/capabilities/*` routes stay hidden unless the
  `agent-runtime-control` experimental flag is enabled and always retain the
  runtime file's bearer-auth boundary. Discovery includes each input JSON
  schema, and the runtime policy must filter discovery and execution together;
  Pulse CLI may access `read`/`operate`, never `unsafe`, by default. The shared
  registry currently exposes browser-tab discovery, live page reads, Canvas
  node read/search/update, and (only when `webview-page-control` is also
  enabled) selector-based page click/fill. Arbitrary page JavaScript is the
  `browser.page.eval` unsafe capability behind the stable deferred `page_eval`
  Canvas Agent tool and requires both flags for external access. Arbitrary
  host-renderer JavaScript is the separate `host.renderer.eval` unsafe
  capability behind the deferred `canvas_host_eval` tool and `pulse-canvas
  runtime host-eval`; it requires `agent-runtime-control`, checks the selected
  workspace route before execution, and runs in the host page's main world.
  It has no direct Node `require`, but it can call the app's renderer-exposed
  `canvasWorkspace` preload bridge and therefore can trigger privileged main
  actions. These are the only Pulse CLI `unsafe` exceptions.
  External node updates are limited to title/content; arbitrary internal
  `data` patches remain Canvas-Agent-only.
- Canvas node and edge shapes are sourced from `src/shared/canvas.ts`, not the
  shorter README node table. Current host node types include `file`,
  `terminal`, `frame`, `group`, `agent`, `text`, `iframe`, `image`, `shape`,
  `mindmap`, `reference`, `dynamic-app`, and `plugin`.
- Cross-mindmap topic transfers are canvas-level atomic transactions: rekey
  every moved topic subtree, update both maps in one history snapshot, and
  degrade bound edges in that same snapshot when a whole source map is removed.
  Topic components own only drag intent; `useNodes` owns mutation and undo.
- Plugin nodes use stable host type `plugin` with plugin-owned
  `data.payload`. **New node capabilities default to plugin nodes** (decided
  2026-07-08); extending the host `CanvasNode['type']` union is the
  exception, reserved for nodes needing main-process integration the plugin
  capability registry can't cover (a persistent session/IPC channel like
  PTY, or a dedicated storage-migration path) — see
  `harness/skills/add-canvas-node/SKILL.md`.
- The channel plugin is inert unless the experimental flag and channel config
  are enabled; keep channel credentials in local settings/env, not source.

## Common Commands

```bash
pnpm --filter canvas-workspace typecheck
pnpm --filter canvas-workspace test
pnpm --filter canvas-workspace build
pnpm --filter canvas-workspace dev
pnpm --filter canvas-workspace dev:temp-home
```

Harness commands for interaction-heavy or visual changes:

```bash
pnpm --filter canvas-workspace harness start --profile demo --build
pnpm --filter canvas-workspace harness status
pnpm --filter canvas-workspace harness snapshot-ui
pnpm --filter canvas-workspace harness screenshot
pnpm --filter canvas-workspace harness logs --lines 120
pnpm --filter canvas-workspace harness close --cleanup
```

Packaging commands exist, but are slower and platform-dependent:

```bash
pnpm --filter canvas-workspace package
pnpm --filter canvas-workspace package:mac
pnpm --filter canvas-workspace package:mac:arm64
pnpm --filter canvas-workspace package:win
pnpm --filter canvas-workspace package:linux
```

## Key Files

- `src/main/index.ts`: thin Electron main entrypoint.
- `src/main/app/bootstrap.ts`: startup wiring for IPC, canvas storage, agent,
  teams, plugins, runtime-control, window creation, and teardown.
- `src/preload/index.ts`: exposes `window.canvasWorkspace` and assembles bridge
  APIs.
- `src/renderer/src/App.tsx`: top-level renderer routes, shell, settings, and
  plugin route/nav integration.
- `src/renderer/src/components/Canvas/`: canvas surface and interaction wiring.
- `src/renderer/src/components/Workbench/`: mounted workspace state and chat
  portal ownership.
- `src/renderer/src/components/RightDock/`: tabbed right dock for chat and
  previews. Link tabs register their live webviews under the stable dock tab id;
  a link tab's webview mounts lazily on first activation (DockPanes gates
  `LinkTabView`'s `mountWebview`) so restored docks don't spawn one guest
  process per tab on the cold-start path — once mounted it stays mounted, and
  agent tools that activate a tab before reading it poll for the registration
  via `main/webview/ensure-operable.ts`.
  page-element selection must reuse the shared iframe DOM picker/selection
  context and route the result through Workbench's active-workspace chat bridge.
  That bridge must queue selections until the target composer registers; opening
  chat and retrying on the next animation frame is not a reliable mount barrier.
- `src/shared/canvas.ts`: canonical canvas node, edge, reference, and workspace
  node contracts.
- `src/main/dock/`: right-dock tab support in main — `tab-store.ts` (renderer
  tab mirror for `canvas_list_tabs`), `tab-actions.ts` (main→renderer
  workspace-scoped `dock:activate-tab` push behind `canvas_activate_tab` and
  the page_* tools' tab targeting, plus the app-level `dock:open-tab` push
  behind `canvas_open_tab` and the app-level `dock:open-artifact` push used
  by the scheduled memory report — artifact workspaceId is a storage scope
  and may be the `__global_chat__` sentinel),
  `history-store.ts` (web-tab browsing history behind `canvas_search_history`).
  The renderer projection in `RightDock/tabRefs.ts` is the tab-discovery SSOT:
  it covers link, artifact, node-detail, canvas-preview, and terminal tabs plus
  active/visible/split state; terminal commands use `canvas_execute_terminal_tab`.
- `src/main/webview/lifecycle.ts`: shared Canvas-node and right-dock webview
  lifecycle policy. Real-time Feishu/Lark hosts remain eligible for the 1fps
  paint throttle but are exempt from L2 freeze and therefore L3 discard; match
  the guest's current URL, not the node/tab's originally saved URL.
- `src/main/canvas/store.ts`: workspace manifest/store IPC, watchers, export,
  import, and migration hooks.
- `src/main/canvas/storage.ts`: atomic JSON I/O, v2 split storage, migration,
  recovery, and pollution detection.
- `src/main/agent/`: Canvas Agent service, session store, prompt/model config,
  tools, and chat IPC.
- `src/main/agent-teams/`: agent-team service, store, IPC, PTY bridge, and
  canvas node integration.
- `src/main/runtime/control-server.ts`: loopback runtime server used by live
  `pulse-canvas` commands.
- `src/plugins/main/`, `src/plugins/renderer/`, `src/plugins/types.ts`: Canvas
  plugin registries and shared plugin contracts.
- `harness/`: workspace harness container — `knowledge/` (conventions + maps),
  `tools/driver/` (Electron launch, CDP, screenshot, input, logs, cleanup),
  `skills/` (agent procedures), `validate/` (check bindings).
