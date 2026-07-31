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
| Keyboard shortcuts | `src/renderer/src/shortcuts/` is the runtime SSOT — `definitions.ts` (the binding table), `types.ts`, `registry.ts` (matching + platform-correct labels). Behavior lives in the owner's handler table: `hooks/useCanvasKeyboard.ts` (owner `canvas`, gated on the visible unlocked canvas) and `hooks/useAppShortcuts.ts` (owner `app`, every route); both are `Record<ShortcutIdFor<'…'>, Handler>`, so a documented-but-unimplemented shortcut is a TYPE ERROR — that is what previously let `Cmd+Shift+A` ship in the help overlay and the palette with no handler while silently running select-all. Never hand-write a chord condition or a `'Cmd+D'` label again: the lazy `?` overlay (`components/AppShellProvider/ShortcutsDialog.tsx`) exhaustively maps runtime IDs to display metadata and derives combo labels from the registry; palette hints (`Canvas/hooks/useCanvasPaletteCommands.ts`) also derive from the registry. Keep help-only descriptions and gestures behind that lazy boundary instead of adding them to the startup matcher. Matching is EXACT on modifiers. macOS eats `Cmd+H`/`Cmd+Tab` before the renderer — use literal `ctrl: true` there. `editable: 'allow'` is what keeps a chord alive inside a text field or terminal (only for chords with no typing meaning). Menu accelerators in `src/main/app/menu.ts` outrank ALL of this: the Undo/Redo and zoom roles are deliberately gone so the canvas can own `Cmd+Z` and `Cmd+0/±`. Focus black holes are closed at the edges — webview guests forward a narrow whitelist (`src/shared/webview-shortcuts.ts` → `src/main/webview/shortcut-forwarding.ts` → `hooks/useWebviewShortcutBridge.ts`), and a focused terminal keeps Ctrl-chords but yields Cmd-chords and releases focus on double-Escape (`decideTerminalKey` in `AgentNodeBody/utils/terminal.ts`). Bound checks: the `keyboard-shortcuts` rule in `harness/validate/validation.yaml` |
| Cross-process API bridge | `src/preload/index.ts`, `src/preload/bridge/`, `src/renderer/src/types.ts`, `src/shared/` |
| Add a capability spanning main + preload + renderer | `harness/skills/add-ipc-surface/SKILL.md` (ordered procedure — contract placement, streaming pattern, bootstrap wire, lockstep rule) |
| Canvas node/edge schema | `src/shared/canvas.ts` |
| Add a new canvas node capability | `harness/skills/add-canvas-node/SKILL.md` (ordered procedure — plugin is the default path, host type is the exception); background: `harness/knowledge/plugin-node-mf2.md` (plugin path), `src/shared/canvas.ts`, `src/renderer/src/utils/nodeFactory.ts`, `src/renderer/src/components/CanvasNodeView/` (host-type touch points) |
| Current registries (agent tools / IPC pairs / node types) | run `node harness/tools/describe-canvas.mjs` (from this dir; `--json` for machines) |
| Visual-regression baseline for ui/ pieces | `harness/tools/ui-showcase/README.md`; run `pnpm run visual` / `pnpm run visual:update` |
| Canvas persistence and migration | `src/main/canvas/store.ts`, `src/main/canvas/storage.ts`, `src/main/canvas/nodes/` (NB: `nodes/` here = knowledge-node records + tags, NOT node types) |
| Node Detail (knowledge-node detail surface) | ONE panel, `WorkspaceNodes/NodeDetailPanel.tsx`, in TWO hosts: the `/nodes/<ws>/<id>` page (`NodeDetailPage.tsx`) and the dock tab (`RightDock/NodeDetailDockTab.tsx`, `mode="dock"`). The dock is the primary entry — list cards, graph nodes and note mentions all open a tab, the page is the drill-down — so a reading aid that renders only in `mode==='page'` is invisible to most users. Its subject is a `WorkspaceNodeRecord` (knowledge atom, no x/y/w/h), rendered through the real `CanvasNodeView` (`NodeCanvasPreview` adapts record→CanvasNode, `embedded hideHeader`; layout patches are dropped). **The adapter must never reject into a node body**: the canvas's own `onUpdate` never rejects, so every body calls it fire-and-forget (TextNodeBody, MindmapNodeBody, IframeNodeBody) — a rejection reached nobody and surfaced as an unhandled rejection, while the pre-fix re-read on failure discarded exactly the edit that had failed to save. A failed record write now HOLDS the optimistic content (external change events are refused while it is held), shows a retry/discard banner, and merges further failures into the same pending patch. FileNodeBody's own `.note-save-status` reports *file* writes — a disjoint failure, so both may show. `workspace-node:read` answers a deleted node with `ok` + NO record: `useWorkspaceNode` exposes that as `missing`, and a host that conflates it with "nothing selected" tells someone their deleted node is merely unselected (the dock tab must also stop advertising the old title). Cross-surface travel is window events, never host callbacks threaded through the shared panel — `useNodeDetailBridges` (page↔canvas, `FOCUS_NODE_ON_CANVAS_EVENT`) and `dispatchOpenNode` for relation rows. The page owns its own Escape (`NodeDetailPage`, bubble-phase + target-gated): `useEscapeClose` is capture-phase and stops propagation, so a page-level subscriber would eat the Escape that closes the tag picker or cancels a title edit. Tests: `__tests__/NodeDetailPanel.test.tsx`, `__tests__/NodeCanvasPreview.test.tsx` (save-failure guards), `__tests__/NodeDetailPage.escape.test.tsx`, `useWorkspaceNodes.test.tsx` |
| Canvas Agent and tools | `src/main/agent/`, `src/main/agent/tools/`, `src/renderer/src/components/chat/` |
| xterm sizing for agent/terminal surfaces | `AgentNodeBody/utils/terminal.ts` owns the shared policy for every xterm in the app (agent nodes, terminal nodes, the workspace terminal dock). NEVER call `fitAddon.fit()` directly — go through `fitTerminalIfSane` / `fitTerminalWithCanvasScale`. FitAddon clamps at 2 columns, so a container measured mid-layout (unsized node, hidden/re-parented terminal, `--canvas-scale` in flight) proposes 3–5 columns; a coding agent renders its OWN layout to the PTY width, so applying that hard-wraps every line it prints into a 4-character ribbon that no later re-fit can reflow (xterm reflows only its own soft wraps) and the scrollback persists it. Skipping the bad pass is free: `scheduleTerminalFit`'s ladder (now + 2 frames + 80ms + 240ms) and the debounced ResizeObserver re-fit apply the real geometry. That ladder also `scrollToBottom()`s each pass — mount-time writes land while the terminal is still sizing, which is what left a restored session parked mid-history — but the ResizeObserver path must NOT scroll: it fires while the user reads history. Tests: `AgentNodeBody/utils/terminalFit.test.ts` |
| AI Chat loading states | Two independent flags, do not conflate: `sessionsLoading` = the session LIST is being fetched (rail spinner in `ChatSessionsRail.tsx`, panel dropdown in `ChatHeader.tsx`); `sessionLoading` = THIS conversation's messages are being fetched (`ChatThreadSkeleton.tsx` in place of the thread, via `ChatView` → `ChatMessages`). Both live in `hooks/useChatSessions.ts`. Every thread-replacing IPC (`getHistory`, `loadSession`, `loadCrossWorkspaceSession`) MUST go through `runThreadFetch`: it owns the flag AND the monotonic request token that drops superseded responses — without it two quick session picks let the slower one overwrite the session the user actually chose, and `handleNewSession` must keep bumping that token so an abandoned load can't repaint a blank new chat. `sessionLoading` is seeded TRUE at mount (effects run after first paint, so a false seed flashes the empty state); `skipInitialHistory: true` therefore obliges the caller to call `handleLoadSession`. A third flag, `useChatStream`'s `loading`, means "the model is generating" — that one drives the three-dot `.chat-loading`, never the skeleton. Sending is vetoed while `sessionLoading` (the mirror of the session switches already blocked while streaming); the veto is `useMentions`' `isSubmitBlocked` because the composer has TWO submit paths — send button and `handleKeyDown`'s Enter — so a guard in a caller's `handleSubmit` alone is a hole. Tests: `hooks/useChatSessions.test.tsx`, `hooks/useMentions.submit-veto.test.tsx`, `__tests__/ChatSessionLoading.test.tsx` |
| Full-page chat ↔ dock Tabs | The full-page chat topbar (`chat/ChatPageBody.tsx`, shared by the AI Chat page and a scheduled task's chat page) has NO close button; its right-most control shows/hides the dock's CONTENT tabs (link/artifact/node-detail/canvas-preview) beside the chat and must never navigate — a control that routes away from the page the user is reading is not a panel toggle. `RightDock/dock-content-tabs.ts` owns that switch (`store.toggleContentTabs`): `openChat`/`toggleChat` cannot serve these routes because the tab they target is hidden, and an expanded dock still pointing at the chat/terminal tab must be re-pointed at a content tab rather than collapsed, or the first click reads as a no-op. The button stays visible but disabled when no content tab exists yet (a tab can land mid-conversation, e.g. the agent opening an artifact/preview, and its topbar position must not jump around as that happens) — `chat.noDockTabs` labels the disabled state. Those routes reflow like any other (`reserveSpace`) — the dock inset must NOT be gated on `chatTabEnabled`, which is what let a link tab overlay and cover the AI Chat page. Esc and ⌘/Ctrl+Shift+L remain the exits from the AI Chat route. Tests: `RightDock/__tests__/dock-content-tabs.test.ts`, the no-chat-tab inset case in `RightDock/index.test.tsx` |
| Dock width policy | `RightDock/dock-width.ts`. The canvas may grow the dock to ~95% of the viewport (the canvas reflows behind it); every page route caps it at 50% (`capWidth`), because a page IS the content and a 95% dock leaves a chat thread in a gutter. Keep the two layers separate: `chosenWidth` (dragged + persisted) vs the rendered `clampDockWidth(...)` — clamping the stored value would silently discard a wide canvas dock the first time the user opens a page route, and the clamp handed to `useDockSplitView` must keep a STABLE identity (it is an effect dep; a per-route identity re-clamps on every navigation). `.right-dock` animates `width` on the same curve as `.app-body`'s `margin-right` so a route switch moves page and dock edge together; drag-resize opts out via `.right-dock-resizing`. Tests: `RightDock/__tests__/dock-width.test.ts` + the capped-render case in `RightDock/index.test.tsx` |
| Multi-role chat (@角色 group chat + relay) | `src/shared/agent-roles.ts` (role contract, `@[role:<id>\|<name>]` marker, speaker-label SSOT, `RoleTurn*Event` stream payloads), `src/main/agent/roles-store.ts` + `agent-roles-ipc.ts` (global library at `~/.pulse-coder/canvas/roles.json`, `agent-roles:*`), `src/main/agent/role-turn.ts` (persona section + BOTH model-history label injection points — live push and session reload MUST stay in lockstep — plus the relay boundary policy `shouldRunRelaySegment`, all pinned by `src/main/agent/__tests__/role-turn.test.ts`). Routing parses ALL role markers from the message text main-side (order-preserving, id-deduped): one → single persona turn, several → a RELAY where each role runs as its own engine segment against the shared history, so segment N+1 reads segment N's labeled reply; edit/regenerate replays re-run the whole turn with zero extra plumbing. Stored content stays clean (【name】 labels exist only on the model-facing copy) and speaker name/color are per-message snapshots that survive role edits/deletes. Stream protocol: every turn emits `role-turn-start/end:{sessionId}` (total=1 for single speakers); `canvas-agent:stop-relay` is the graceful boundary stop (current speaker finishes, queued ones are skipped) — the composer abort stays the hard stop. Agent@agent handoff (P2, opt-in): library switch `allowRoleHandoff` lives in roles.json settings (Settings → Chat Roles card, `agent-roles:settings-get/save`, default OFF, role writes preserve it). When ON, each ROLE segment's reply is scanned for plain-text `@RoleName` (`findRoleNameMentions`: name-based because models never emit internal markers; longest-name-first with span consumption, ASCII case-insensitive) and matches are appended to the SAME turn's queue — policy in `resolveHandoffRoles`: self dropped, already-queued deduped, roles that SPOKE may re-enter, and growth (never the user-named speakers) is capped by `ROLE_RELAY_MAX_SEGMENTS`=30 (Stop relay ends a long discussion early). Appended queue refs carry `namedBy` (RelayBar dashed underline + "由 X 点名" tooltip; the bar can appear mid-turn when a single-role turn grows — pinned in `relayTurnHandlers.test.ts`); default-assistant segments never hand off, and a pending graceful stop freezes the queue. Renderer: `role` mention group, speaker badge in `ChatMessage.tsx`, per-segment bubbles + completion policy in `hooks/relayTurnHandlers.ts` (tested), `RelayBar.tsx` progress strip, `RolesSettings.tsx` behind the Settings `chat-roles` section. Role accents everywhere come from one renderer cache — `hooks/roleMentionItems.ts` (popup entries + id→color map, 5s TTL, `useRoleColors()`, invalidated by Settings save/delete) — and chips recolor by overriding the `--role-accent*` tokens inline per chip (`utils/mentions.ts`), so unknown/deleted role ids fall back to the violet class tokens. Externally-driven roles (local coding agents): `AgentRoleDefinition.external` = `{family:'claude-code'\|'codex', cwd}` routes that role's segments to `src/main/agent/external/` — headless CLI spawn (`claude -p --output-format stream-json`, prompt via stdin, `--resume` continuity keyed per chat-session×role in `~/.pulse-coder/canvas/external-agent-state.json`, stale-resume retries once fresh; tolerant line parser pinned against real-binary shapes incl. unknown event types), reply appended to the shared model history by hand so the label/persist/handoff tail is identical to engine segments. Tool activity is surfaced: both adapters translate their own vocabulary (Claude `tool_use`/`tool_result`; Codex dialect-A `exec_command_*`/`patch_apply_*`/`mcp_tool_call_*`/`web_search_*` and dialect-B `item.started/completed`) into the SAME onToolCall/onToolResult events the engine emits (`external/tool-events.ts`; a result whose call was never seen back-fills one), and the collected calls persist so a reloaded session keeps its chips. The persona prompt is OPTIONAL for external roles (they carry their own CLAUDE.md/AGENTS.md instructions); persona roles still require one. Safety: external roles respond ONLY to direct user @ (`handoffTargetRoles` excludes them as handoff targets/advertised names — pinned in external-driver tests), cwd existence checked with a config-clear error, permissions defer to the CLI's own config (we pass no permission flags). Codex adapter live (`external/codex.ts`): `codex exec --json` / `exec resume <id>`, stdin sentinel `-`, `--skip-git-repo-check`, parser accepts BOTH shipped JSONL dialects (protocol `msg` events + thread events). Probe IPC `agent-roles:external-probe`; env overrides `PULSE_CANVAS_CLAUDE_CODE_CMD`/`PULSE_CANVAS_CODEX_CMD`/`PULSE_CANVAS_EXTERNAL_AGENT_STATE`. Chat entry: `chat_role_list`/`chat_role_save` in `src/main/agent/tools/roles.ts` — app-level, registered UNWRAPPED on both tool factories, `defer_loading`, no delete (scheduled-tools posture); a tool-created role is @-able within the mention popup's 5s roles-cache TTL. |
| Agent long-term memory (global + per-workspace) | `src/main/agent/memory-store.ts` (store + prompt injection; explicit-save-only by design), `src/main/agent/tools/memory.ts` (`memory_save` eager; `memory_list`/`memory_forget`/`memory_adopt` deferred — `memory_adopt` is the sole cross-workspace write path, reserved for user-confirmed candidates from the `memory-review` default skill), tests in `src/main/agent/__tests__/memory-store.test.ts` + `tools-graph.test.ts` |
| Artifact runtime capabilities (page → host actions) | `src/shared/artifact-capabilities.ts` (trust model + contract), `src/main/artifacts/capability-ipc.ts` (`artifact-capability:invoke`, main-side authoritative validation), `src/renderer/src/components/artifacts/capabilityBridge.ts` + `ArtifactTabView` (host-authored bridge script, postMessage relay, audit toast). Capabilities are declared on the artifact RECORD by creating code (never by the page), gated on a real user gesture in the bridge, and every write surfaces a toast. Current capabilities: `memory.adopt`, `skill.save` (both = the user's click IS the confirmation). Tests: `src/main/artifacts/__tests__/capability-invoke.test.ts` |
| Artifact pin lifecycle + Library drawer | `src/main/artifacts/ipc.ts` — pin refuses sentinel (`__*`) scopes, dedupes against a live mirror, list/get lazily clear a stale `pinnedNodeId`, delete removes the canvas mirror node; `artifact:list-all` (metadata-only summaries) skips `__*` dirs EXCEPT `__global_chat__` (session-store sentinel rule — a blanket skip silently hides global artifacts). Library drawer = renamed ReferenceDrawer: Pinned entries persist per workspace via the `references` IPC domain (`src/main/references/`, `src/shared/references.ts`, hydrate/save in `Workbench/useReferenceEntries.ts`); Artifacts source tab is `ReferenceDrawer/ArtifactsPicker.tsx` (cross-scope pin disabled by design). Tests: `src/main/artifacts/__tests__/pin-lifecycle.test.ts` |
| Headless (background) agent runs | `src/main/agent/headless-run.ts` (one-shot bounded Engine run: no session store, `builtInTools:{}` = structurally read-only, wall-clock timeout, never throws), `src/main/agent/memory-report.ts` (first consumer — cross-workspace memory report as self-contained HTML; adoption stays interactive-only; scheduled entry archives to `<memory>/reports/` with rolling retention AND publishes a `__global_chat__`-scoped artifact, surfaced by an OS notification whose click pushes `dock:open-artifact`). Tests: `src/main/agent/__tests__/headless-run.test.ts` |
| Scheduled tasks | `src/main/scheduled/` — stable top-level Scheduled surface with persisted user-defined tasks, an exact next-due main-process timer backed by a 30-minute heartbeat, startup/resume catch-up, manual run-now, and one isolated durable Agent chat scope per task. Cadence is the `ScheduledSchedule` union in `src/shared/scheduled.ts`: `interval` (relative, minimum 30 minutes, anchored at create/enable/last-attempt) or `daily`/`weekly` at a LOCAL wall-clock `HH:mm`. `computeNextRunAt` is the single next-run authority for all three kinds — use local `Date` field arithmetic there, never fixed millisecond offsets, so absolute slots survive DST. A slot missed while the app was closed runs ONCE on catch-up and then realigns to the next slot (never one run per missed slot); failed attempts consume the current slot rather than hot-looping. Pre-`schedule` records carrying `intervalMinutes` are lifted into the union on read (`migratePersistedTask`); the field is gone from the live contract. The built-in weekly memory-report prompt is seeded idempotently as a disabled Scheduled task on `weekly` Monday 09:00 local; it is no longer an Experimental entry. Seeding is one-shot by design — an install that already carries the task keeps its stored schedule, so the Monday default reaches new installs only. A finished attempt — success AND failure — is announced by `announceRunFinished` (`scheduled/runtime.ts`) as a `scheduled:run-finished` push that `useScheduledRunToasts` turns into a STICKY toast (`autoCloseMs: 0`); its action opens the task's conversation in the DOCK's Pulse AI tab (`useScheduledRunChatOpener` → `dock.openScheduledChat`), the same surface `Run now` uses — acting on a finished run must never navigate the whole app onto the AI Chat page and lose what the user was looking at. Routing to `/chat?scheduledTask=<id>` survives only as the fallback for views that hide the dock chat tab; `isDockChatTabEnabled` (`components/RightDock/dock-chat-availability.ts`) is the single predicate behind BOTH that fallback and the dock's `chatTabEnabled` prop, because a caller that assumes a dock chat tab where there is none swallows the open silently. The same module derives `isGlobalChatLauncherVisible` — the floating Pulse-logo launcher (`RightDock/GlobalChatLauncher.tsx`) shows on every route that has a dock chat tab and no chat chrome of its own, canvas being the one exception; deriving it stopped the Scheduled page from being hand-excluded with no way to reach the agent (`__tests__/dock-chat-availability.test.ts`). Each task's chat is a session STORE (`__scheduled__-<taskId>`), listed in that rail beside workspaces and global chat — `src/shared/agent-chat.ts` owns the store-id vocabulary (`scopeSessionStoreId`, `scheduledTaskIdFromStoreId`, `isListableSessionStore`), and every consumer that maps a listed session back to a scope MUST go through it: a sentinel store id treated as a workspace id activates an agent against a workspace that does not exist. `__`-prefixed stores are allowlisted, never blanket-skipped (that is what hid scheduled chats from the rail). Deliberately in-app only: OS `Notification` was tried and removed (Focus modes, missing notification daemons, unsigned dev builds, and Windows-without-AppUserModelID all drop it silently, and it needed a retained-reference dance to survive GC), so do not reintroduce a second channel — `scheduled-run-notify.test.ts` asserts none is raised. A run finishes while nobody is watching, so the toast must never expire on a timer. IPC contract: `src/shared/scheduled.ts` → `src/preload/bridge/scheduled.ts` → renderer `components/Scheduled/`; list rows are presentational — every action is an explicit button, and the time picker is hour/minute `ui/Select`s, never a native `<input type="time">`. Chat entry: `scheduled_task_list`/`_create`/`_update` in `src/main/agent/tools/scheduled.ts` — app-level, so registered UNWRAPPED on both tool factories, all `defer_loading`, no delete (see `harness/knowledge/security-posture.md` for why); it dynamic-imports `scheduled/runtime` to avoid the tools→runtime→agent-service module cycle. Tests: `src/shared/scheduled.test.ts` (schedule validation + next-run math), `src/main/__tests__/scheduled-task-service.test.ts`, `src/main/__tests__/scheduled-run-notify.test.ts` (completion push, success AND failure, and no OS notification), `components/Scheduled/__tests__/useScheduledRunToasts.test.tsx` (sticky toast), `components/Scheduled/__tests__/scheduledChatTarget.test.ts` (dock-by-default vs route fallback), `src/main/agent/__tests__/scheduled-tools.test.ts`, `components/Scheduled/__tests__/TaskEditorModal.test.tsx` + `ScheduledPage.test.tsx`, plus scheduled-scope coverage in `src/main/agent/__tests__/service-history.test.ts`. |
| Dock web tabs (the embedded browser) | Read `harness/knowledge/dock-browser.md` before changing guest navigation, identity/routing, retention, focus, shortcuts, or tab overflow. Key contracts: `src/shared/webview-registration.ts`, `src/shared/link-open.ts`, `src/shared/dock-shortcuts.ts`; main policy/registry under `src/main/app/` + `src/main/webview/`; renderer ownership under `IframeNodeBody/webview-identities.ts`, `RightDock/`, and `LinkDrawer/`. |
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
- Canvas Agent scope activation must stay single-flight in
  `src/main/agent/service.ts`: chat entry concurrently requests history and
  session lists, so an unguarded check-then-initialize creates duplicate
  engines for one scope and makes session switching visibly stall. Guard:
  `src/main/agent/__tests__/service-history.test.ts`.
- One chat scope has one authoritative run and one session-mutation lane.
  `ActiveChatRegistry` owns IPC-visible run identity/abort/reconnect, while
  `SessionMutationCoordinator` serializes chat against new/load/branch/delete/
  rename/pin/import mutations; renderer scope activity is only a UX mirror.
  Current senders must use prepare → subscribe → start: prepare reserves the
  scope before returning, start upgrades that reservation and freezes the
  main-resolved model into the persisted turn snapshot. A reservation owns the
  run's AbortController so hard Stop latches even before start. The renderer
  also sends its visible conversation-session id; after the mutation lane is
  idle, main must compare-and-swap that pointer before calling the agent and
  return the authoritative history on mismatch. Guards: `active-chat-registry.test.ts`,
  `prepared-chat.test.ts`, `chat-protocol.test.ts`, `chat-session-cas.test.ts`,
  and `__tests__/service-session-mutation.test.ts`.
- The renderer has one visible approval card, so main must serialize concurrent
  clarification requests and start each timeout only when that request becomes
  visible. Answering one request must reveal, not clear, the next queued
  request. Guard: `clarification-registry.test.ts`.
- Conversation pointer changes are fail-closed. Archive publication and the
  replacement current-session write must complete before the in-memory pointer
  advances; queued persistence failures must remain observable through
  `flush()`, while the serialization tail stays usable for repair. Archive
  filenames must remain collision-safe even when timestamps and titles match.
  Once a promoted session is durably current, cleanup of its stale archive
  copies is best-effort: a cleanup failure must not report that the already
  committed pointer change failed. Deleting the current session reverses that
  order: stale data copies are removed before publishing the replacement
  pointer, while post-commit metadata cleanup is best-effort.
  Guard: `src/main/agent/__tests__/session-store.test.ts`.
- Chat image uploads are bounded again in main before a prepared run is
  accepted. Explicitly removing a ready draft attachment deletes its saved
  file; clearing a successfully sent draft must retain the file because
  session history references it. A failed turn must persist the live tool-call
  snapshot and settle unfinished tools so reload matches the streamed UI.
  Guards: `useChatAttachments.test.tsx`, `chat-protocol.test.ts`, and
  `chat-failure-persistence.test.ts`.
- An external-role driver rejection after its AbortSignal fires is a stopped
  turn, never a failed turn. Preserve streamed partial text, merge live tool
  events that the rejected driver could not return, and settle unfinished
  tools as cancelled. Guards: `segment-execution.test.ts` and
  `chat-stop.test.ts`.
- The full-screen chat rail is one stable cross-scope projection. Do not swap
  per-scope list caches into it or fetch a list while `loadSession` is
  promoting an archive: either path can duplicate/reorder rows under the
  pointer and move the scroll position. Commit current/other lists together
  after promotion; guards live in `useChatSessions.test.tsx` and
  `ChatSessionsRail.test.tsx`.
- Chat-target registration is synchronously observed at the app root. Props
  that feed a mounted `ChatPanel` target or its registered handlers must use
  stable empty collection fallbacks; an inline `[]` makes the target unregister
  and re-register on every broker-driven root render, reaches React's maximum
  update depth, and clears the renderer. Workbench's node and selection
  fallbacks are module constants and are covered by
  `Workbench/__tests__/ChatDockLifecycle.test.tsx`; knowledge chat applies the
  same stable-fallback rule, but is not exercised by that guard.
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
  process per tab on the cold-start path — once mounted it stays resident until
  an explicit eligible L3 Memory Saver discard, and agent tools that activate a
  tab before reading it poll for registration via `main/webview/ensure-operable.ts`.
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
