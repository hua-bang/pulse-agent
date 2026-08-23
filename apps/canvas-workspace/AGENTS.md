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
through manifests and plugin registries (runtime-loadable plugin dirs; the
former in-repo example `packages/canvas-nodes` was removed in the 2026-08
slim-down — see tag `pre-slim-archive` for a reference implementation).

Keep this file as the local router. Put durable implementation detail in
existing workspace docs or tests. Add new workspace docs only when a behavior
or operating runbook needs a durable source of truth.

**Local harness layout** — `harness/` is this workspace's repo-harness
container, aligned with `packages/engine/harness/`:
- `harness/knowledge/` — per-topic knowledge files, routed in the Knowledge
  Navigation table below (`docs/` keeps only project records like perf
  analyses and roadmaps).
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
  `diagnose-agent-latency` (trace and optimize Agent turn latency),
  `validate-canvas-change` (choose quick/standard/release evidence),
  `add-canvas-node`, `add-agent-tool`, `add-builtin-main-plugin`,
  `extend-blessed-ui`, `add-ipc-surface` (safe-change procedures for the
  five recurring extension shapes).
- `harness/spec/` — decision-pending intent; empty is the success state. Surface definition: ../../packages/engine/harness/spec/README.md; resolved entries end as tests/skills, then delete.
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
| Renderer routes and full-app surfaces | `harness/knowledge/renderer-surfaces.md`, `src/renderer/src/App.tsx`, `src/renderer/src/components/shell/Workbench/`, `src/renderer/src/components/dock/RightDock/` |
| Keyboard shortcuts | Read `harness/knowledge/keyboard-shortcuts.md` before adding/changing/removing a shortcut, editing `menu.ts` accelerators, or touching webview/terminal key handling. Key contracts: `shortcuts/definitions.ts`, `shortcuts/registry.ts`, `hooks/useCanvasKeyboard.ts`, `hooks/useAppShortcuts.ts`, `src/main/app/menu.ts`, `src/shared/webview-shortcuts.ts`. Bound tests (`keyboard-shortcuts` rule, `harness/validate/validation.yaml`): `shortcuts/registry.test.ts`, `hooks/useCanvasKeyboard.test.ts`, `hooks/useAppShortcuts.test.ts`, `src/main/webview/__tests__/shortcut-forwarding.test.ts`, `AgentNodeBody/utils/terminalKeys.test.ts`, `AgentNodeBody/utils/terminalFocus.test.ts`, `shortcuts/terminalShortcuts.test.ts`. |
| Cross-process API bridge | `src/preload/index.ts`, `src/preload/bridge/`, `src/renderer/src/types.ts`, `src/shared/` |
| Add a capability spanning main + preload + renderer | `harness/skills/add-ipc-surface/SKILL.md` (ordered procedure — contract placement, streaming pattern, bootstrap wire, lockstep rule) |
| Canvas node/edge schema | `src/shared/canvas.ts` |
| Add a new canvas node capability | `harness/skills/add-canvas-node/SKILL.md` (ordered procedure — plugin is the default path, host type is the exception); background: `harness/knowledge/plugin-node-mf2.md` (plugin path), `src/shared/canvas.ts`, `src/renderer/src/utils/nodeFactory.ts`, `src/renderer/src/components/canvas/CanvasNodeView/` (host-type touch points) |
| Current registries (agent tools / IPC pairs / node types) | run `node harness/tools/describe-canvas.mjs` (from this dir; `--json` for machines) |
| Visual-regression baseline for ui/ pieces | `harness/tools/ui-showcase/README.md`; run `pnpm run visual` / `pnpm run visual:update` |
| Canvas persistence and migration | `src/main/canvas/store.ts`, `src/main/canvas/storage.ts`, `src/main/canvas/nodes/` (NB: `nodes/` here = knowledge-node records + tags, NOT node types) |
| Node Detail (knowledge-node detail surface) | Read `harness/knowledge/node-detail.md` before changing the panel/host split, `enterNodePage`, the record→CanvasNode adapter, `nodeDetailDescriptor.ts`, save-failure handling, or missing-node/cross-surface/Escape behavior. Key contracts: `WorkspaceNodes/NodeDetailPanel.tsx`, `WorkspaceNodes/nodeDetailDescriptor.ts`, `WorkspaceNodes/NodeCanvasPreview.tsx`, `RightDock/dock-store.ts`, `WorkspaceNodes/useWorkspaceNodes.ts`, `Workbench/KnowledgeChatPortal.tsx`. Tests: `WorkspaceNodes/__tests__/NodeDetailPanel.test.tsx`, `RightDock/__tests__/dock-store.test.ts`, `Workbench/__tests__/ChatDockLifecycle.test.tsx` |
| Canvas Agent and tools | `src/main/agent/`, `src/main/agent/tools/`, `src/renderer/src/components/chat/` |
| Diagnose Canvas Agent latency or verify an optimization | `harness/skills/diagnose-agent-latency/SKILL.md`; trace model and exporter details: `harness/knowledge/langfuse-observability.md` |
| Canvas Agent full-chain Langfuse observability | `harness/knowledge/langfuse-observability.md` |
| xterm sizing for agent/terminal surfaces | Read `harness/knowledge/terminal-surfaces.md` before changing xterm sizing/fit behavior for agent nodes, terminal nodes, or the workspace terminal dock. Key contracts: `AgentNodeBody/utils/terminal.ts`, `TerminalNodeBody/index.tsx`, `WorkspaceTerminalDock/index.tsx`. Tests: `AgentNodeBody/utils/terminalFit.test.ts` |
| AI Chat loading states | Read `harness/knowledge/chat-sessions.md` before changing session loading flags (`sessionsLoading` vs `sessionLoading` vs stream `loading`) or the submit veto. Key contracts: `src/renderer/src/components/chat/hooks/useChatSessions.ts`, `hooks/useMentions.ts`, `ChatSessionsRail.tsx`, `ChatHeader.tsx`, `ChatThreadSkeleton.tsx`. Tests: `hooks/useChatSessions.test.tsx`, `hooks/useMentions.submit-veto.test.tsx`, `__tests__/ChatSessionLoading.test.tsx` |
| Full-page chat ↔ dock Tabs | Read `harness/knowledge/chat-sessions.md` before changing the full-page chat topbar, its dock-content-tabs toggle, or the dock inset rule. Key contracts: `chat/ChatPageBody.tsx`, `RightDock/dock-content-tabs.ts`. Tests: `RightDock/__tests__/dock-content-tabs.test.ts`, `RightDock/index.test.tsx` |
| Dock width policy | Read `harness/knowledge/chat-sessions.md` before changing right-dock width behavior. Key contract: `RightDock/dock-width.ts`. Tests: `RightDock/__tests__/dock-width.test.ts`, `RightDock/index.test.tsx` |
| Coding agents in the Coding Agent node (roster, brand marks, launch flags, per-node session binding) | Read `harness/knowledge/coding-agent-registry.md` before adding/removing an agent, changing per-agent launch flags, or changing how a node binds to one CLI conversation. Key contracts: `src/renderer/src/config/agentRegistry.ts`, `AgentNodeBody/utils/piSession.ts`, `src/main/agent/codex-sessions.ts`. Bound tests (`coding-agent-roster` rule, `harness/validate/validation.yaml`): `AgentNodeBody/__tests__/AgentPicker.test.tsx`, `AgentNodeBody/__tests__/AgentIcon.test.tsx`, `AgentNodeBody/__tests__/piSessionBinding.test.tsx`, `AgentNodeBody/utils/piSession.test.ts`, `utils/__tests__/codingAgentCommand.test.ts`. |
| Multi-role chat (@角色 group chat + relay) | Read `harness/knowledge/agent-roles.md` before changing role marker/routing, the relay stream protocol, handoff policy, renderer role rendering, external CLI drivers, or the stopped-vs-failed turn rule. Key contracts: `src/shared/agent-roles.ts`, `src/main/agent/role-turn.ts`, `src/main/agent/roles-store.ts`, `src/main/agent/external/`, `src/main/agent/chat-stop.ts`. Tests: `src/main/agent/__tests__/role-turn.test.ts`, `src/main/agent/__tests__/external-driver.test.ts`, `src/main/agent/segment-execution.test.ts`, `src/main/agent/chat-stop.test.ts`. |
| Agent long-term memory (global + per-workspace) | `src/main/agent/memory-store.ts` (store + prompt injection; explicit-save-only by design), `src/main/agent/tools/memory.ts` (`memory_save` eager; `memory_list`/`memory_forget`/`memory_adopt` deferred — `memory_adopt` is the sole cross-workspace write path, reserved for user-confirmed candidates from the `memory-review` default skill), tests in `src/main/agent/__tests__/memory-store.test.ts` + `tools-graph.test.ts` |
| Artifact runtime capabilities (page → host actions) | `src/shared/artifact-capabilities.ts` (trust model + contract), `src/main/artifacts/capability-ipc.ts` (`artifact-capability:invoke`, main-side authoritative validation), `src/renderer/src/components/artifacts/capabilityBridge.ts` + `ArtifactTabView` (host-authored bridge script, postMessage relay, audit toast). Capabilities are declared on the artifact RECORD by creating code (never by the page), gated on a real user gesture in the bridge, and every write surfaces a toast. Current capabilities: `memory.adopt`, `skill.save` (both = the user's click IS the confirmation). Tests: `src/main/artifacts/__tests__/capability-invoke.test.ts` |
| Artifact pin lifecycle + Library drawer | `src/main/artifacts/ipc.ts` — pin refuses sentinel (`__*`) scopes, dedupes against a live mirror, list/get lazily clear a stale `pinnedNodeId`, delete removes the canvas mirror node; `artifact:list-all` (metadata-only summaries) skips `__*` dirs EXCEPT `__global_chat__` (session-store sentinel rule — a blanket skip silently hides global artifacts). Library drawer = renamed ReferenceDrawer: Pinned entries persist per workspace via the `references` IPC domain (`src/main/references/`, `src/shared/references.ts`, hydrate/save in `Workbench/useReferenceEntries.ts`); Artifacts source tab is `ReferenceDrawer/ArtifactsPicker.tsx` (cross-scope pin disabled by design). Tests: `src/main/artifacts/__tests__/pin-lifecycle.test.ts` |
| Headless (background) agent runs | `src/main/agent/headless-run.ts` (one-shot bounded Engine run: no session store, `builtInTools:{}` = structurally read-only, wall-clock timeout, never throws), `src/main/agent/memory-report.ts` (first consumer — cross-workspace memory report as self-contained HTML; adoption stays interactive-only; scheduled entry archives to `<memory>/reports/` with rolling retention AND publishes a `__global_chat__`-scoped artifact, surfaced by an OS notification whose click pushes `dock:open-artifact`). Tests: `src/main/agent/__tests__/headless-run.test.ts` |
| Scheduled tasks | Read `harness/knowledge/scheduled-tasks.md` before changing cadence/DST math, catch-up or `intervalMinutes` migration, the run-finished toast/dock-chat chain, or the scheduled session-store vocabulary. Key contracts: `src/shared/scheduled.ts`, `src/main/scheduled/`, `src/shared/agent-chat.ts`, `components/dock/RightDock/dock-chat-availability.ts`, `src/main/agent/tools/scheduled.ts`. Tests: `src/shared/scheduled.test.ts`, `src/main/__tests__/scheduled-task-service.test.ts`, `src/main/__tests__/scheduled-run-notify.test.ts`, `components/dock/RightDock/__tests__/dock-chat-availability.test.ts`. |
| Dock web tabs (the embedded browser) | Read `harness/knowledge/dock-browser.md` before changing guest navigation, identity/routing, retention, focus, shortcuts, or tab overflow. Key contracts: `src/shared/webview-registration.ts`, `src/shared/link-open.ts`, `src/shared/dock-shortcuts.ts`; main policy/registry under `src/main/app/` + `src/main/webview/`; renderer ownership under `IframeNodeBody/webview-identities.ts`, `RightDock/`, and `LinkDrawer/`. |
| Add a capability shared by Tool + CLI | `../../harness/skills/add-canvas-capability/SKILL.md`; use `harness/skills/add-agent-tool/SKILL.md` for the optional task-specific Canvas Agent adapter |
| Agent teams | `src/main/agent-teams/`, `src/renderer/src/components/node-bodies/AgentTeamFrame/` |
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
- Packaged builds install `@pulse-coder/canvas-cli` + all bundled skills as one versioned, fingerprinted compatibility bundle under `~/.pulse-coder/`; route every install/repair/update trigger (startup, Settings repair, experimental-flag triggers) through the shared `AgentToolingManager` / `agent-tooling-queue`, never a source checkout, `pnpm`, or a global link.
  Guard: `packaged-agent-tooling` rule in `harness/validate/validation.yaml` (`agent-tooling-manager.test.ts`, `agent-tooling-queue.test.ts`, `shell-path.test.ts`, `agent-tooling-package.test.ts`).
  Detail: `harness/knowledge/packaged-tooling.md`.
- `harness/tools/driver/` launches the real Electron app. Use `temp`, `demo`,
  or `clone` profiles by default; use `real --allow-real-writes` only after
  explicit user intent because it can mutate real Pulse Canvas data.
  Reopening `demo` without `--reset` preserves its existing manifest and
  imported workspaces; fixture reseeding is a reset operation.
- Canvas Agent scope activation must stay single-flight in `src/main/agent/service.ts`, or an unguarded check-then-initialize creates duplicate engines for one scope and session switching visibly stalls.
  Guard: `src/main/agent/__tests__/service-history.test.ts`.
  Detail: `harness/knowledge/chat-sessions.md`.
- Chat run state is conversation-owned: each conversation key has an independent runtime (`conversation-runtime/` in main, `conversationStore.ts` + `useChatComposerStateKeyed` in renderer) over one shared CanvasAgent engine; switching = changing the store selector, two conversations run in parallel, same-conversation second turn queues. Legacy compensation hooks were deleted; `ActiveChatRegistry` stays only for scheduled/back-compat.
  Guard: `conversation-runtime/*.test.ts`, `shared/conversation-runtime.test.ts`, `hooks/conversationStore.test.ts`, `hooks/useChatStream.keyed.test.tsx`, `hooks/useChatStream.shared-snapshot.test.tsx`, `hooks/useChatComposerStateKeyed.test.tsx`, `active-chat-registry.test.ts`, `useChatPagePendingSession.test.tsx`.
  Detail: `harness/knowledge/chat-sessions.md`.
- The renderer has one visible approval card, so main must serialize concurrent clarification requests, starting each timeout only once visible; answering one must reveal, not clear, the next queued request.
  Guard: `clarification-registry.test.ts`.
  Detail: `harness/knowledge/chat-sessions.md`.
- Conversation pointer changes are fail-closed: archive publication and the replacement current-session write complete before the in-memory pointer advances, with collision-safe archive filenames; deleting the current session reverses that order, and post-commit cleanup stays best-effort in both directions.
  Guard: `src/main/agent/__tests__/session-store.test.ts`.
  Detail: `harness/knowledge/chat-sessions.md`.
- Chat image uploads are bounded again in main before a prepared run is accepted; removing a ready draft attachment deletes its file, clearing a sent draft retains it, and a failed turn persists its tool-call snapshot with unfinished tools settled.
  Guard: `useChatAttachments.test.tsx`, `chat-protocol.test.ts`, `chat-failure-persistence.test.ts`.
  Detail: `harness/knowledge/chat-sessions.md`.
- An external-role driver rejection after its AbortSignal fires is a stopped turn, never a failed turn.
  Guard: `segment-execution.test.ts`, `chat-stop.test.ts`.
  Detail: `harness/knowledge/agent-roles.md` (stopped-vs-failed turn rule).
- The full-screen chat rail is one stable cross-scope projection: never swap per-scope list caches into it or fetch a list while `loadSession` is promoting an archive; commit current/other lists together after promotion.
  Guard: `useChatSessions.test.tsx`, `ChatSessionsRail.test.tsx`.
  Detail: `harness/knowledge/chat-sessions.md`.
- Chat-target registration is synchronously observed at the app root: props feeding a mounted `ChatPanel` target or its handlers must use stable empty-collection fallbacks, never an inline `[]`, or the target unregisters/re-registers every root render and hits React's max update depth.
  Guard: `Workbench/__tests__/ChatDockLifecycle.test.tsx` (knowledge chat follows the same rule but isn't covered by this guard).
  Detail: `harness/knowledge/chat-sessions.md`.
- The app owns v2 canvas storage migration, PTY sessions, runtime-control
  endpoints, plugin activation, and UI-visible data recovery. The CLI adapts to
  those contracts but does not own them.
- External canvas-store synchronization must treat edges as first-class state:
  watcher events carry edge ids, renderer reloads must accept edge-only events,
  and stale saves merge edges by `updatedAt` without dropping unsaved local
  edges. Guards: `src/main/__tests__/canvas-store-merge.test.ts` and
  `src/renderer/src/hooks/useNodes.external-update.test.ts`.
- Live-app capabilities live under `src/main/runtime/capabilities/` behind tiered access (`read`/`operate`/`unsafe`) and the runtime server's bearer-auth boundary; Pulse CLI gets `read`/`operate` by default, with `browser.page.eval` (`page_eval` tool) and `host.renderer.eval` (`host_renderer_eval` tool / `pulse-canvas runtime host-eval`) as the only `unsafe` exceptions, each independently flag-gated; external Canvas node updates stay limited to title/content.
  Guard: `src/main/runtime/capabilities/*.test.ts`, `src/main/runtime/__tests__/control-server.test.ts`.
  Detail: `harness/knowledge/security-posture.md` ("Runtime-control capability tiers and registry").
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
- `src/renderer/src/components/canvas/Canvas/`: canvas surface and interaction wiring.
- `src/renderer/src/components/shell/Workbench/`: mounted workspace state and chat
  portal ownership.
- `src/renderer/src/components/dock/RightDock/`: tabbed right dock for chat and
  previews (link, artifact, node-detail, canvas-preview, terminal tabs).
  Behavior: `harness/knowledge/dock-browser.md`.
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
