# Chat sessions

Scope: the Canvas Agent chat surface's session lifecycle — renderer-side
loading states, the full-page chat route's relationship to the right dock's
content tabs, right-dock width behavior, and the main-process layer that keeps
runs session-anchored so different conversations in one workspace can stream
concurrently. Read this
before changing `hooks/useChatSessions.ts`
(`src/renderer/src/components/chat/hooks/useChatSessions.ts`), the full-page
chat topbar / dock content-tabs toggle, `RightDock/dock-width.ts`
(`src/renderer/src/components/dock/RightDock/dock-width.ts`), or
`src/main/agent/service.ts` and its collaborators (`active-chat-registry.ts`,
`session-mutation-coordinator.ts`, `prepared-chat.ts`,
`canvas-run-registry.ts`, `run-session-context.ts`, `session-file-io.ts`,
`clarification-registry.ts`, `session-store.ts`,
`chat-failure-persistence.ts`, `useChatAttachments.ts`).

## Conversation-runtime architecture (2026-09)

Chat run state is now conversation-owned. The workspace owns one shared
CanvasAgent (single Engine + tools/MCP/config/plan-mode) as a stateless runTurn
seam; each conversation key (`ConversationKey = { storeId, sessionId }`) owns an
independent runtime:

- Main: `src/main/agent/conversation-runtime/conversation-runtime.ts`
  (`ConversationRuntime`: messages, queue, abort, clarification, persistence)
  + `conversation-runtime-registry.ts` (per-scope registries) +
  `conversation-service.ts` (service facade) + `conversation-ipc.ts`
  (IPC: `canvas-agent:conversation-chat` / `conversation-abort` /
  `conversation-stop-relay` / `conversation-clarify-answer`).
- Renderer: `conversationStore.ts` (useSyncExternalStore keyed by
  ConversationKey; snapshot cache keeps getSnapshot referentially stable),
  `useConversationRuntimeStream.ts` (keyed stream hook driving the store +
  conversation IPC), `useChatComposerStateKeyed.ts` (composer root used by
  BOTH `ChatPanel` and `ChatPageBody`).

Two conversations in one workspace run fully in parallel; a second turn against
the SAME conversation is queued (not interleaved). Switching conversations is
just changing the store selector — no destroy/replay/lease. The legacy
compensation chains (`useChatStream`, `useChatComposerState`,
`useChatTurnLease`, `useChatScopeActivity` / `chatScopeActivityStore`,
`useChatRunReattach` / `chatRunReattach`, `chatRunWatchdog`,
`useConversationBranching`, `recoverChangedChatSession`, `chatThreadCache`,
`toolStreamState`, `visualStreamSubscription`) were DELETED. The legacy main
path (`ActiveChatRegistry` + `SessionMutationCoordinator` + prepared-chat
protocol) remains only for conversation-less callers (scheduled tasks) and
backward-compatible IPC; it is not the surface path anymore.

Key invariants and their guards:

- Changes to conversation IPC, preload, or main runtime require a full
  Electron restart; renderer HMR cannot validate those contracts and may leave
  an old main process exhibiting already-fixed switching behavior.
- `conversation-chat` acknowledges transport acceptance immediately. The
  model turn continues asynchronously and settles through the keyed
  `chat-complete` event; awaiting model completion in the invoke handler keeps
  successfully submitted text stuck in the composer for the whole turn.
- Rail `Running` badges query `ConversationRuntimeRegistry`, not the legacy
  `ActiveChatRegistry`; keyed runs never register in the legacy prepared-chat
  path. The selected conversation suppresses its own badge, while background
  conversation ids remain visible until their runtime returns to idle.
- The first user message is persisted before the model turn starts. While that
  turn is running, the renderer's keyed conversation store contributes a live
  session row to the rail immediately; the durable session list takes over once
  the turn settles. This keeps a newly-created chat visible and preserves its
  `Running` marker when the user switches away.
- Terminal background activity is renderer-global and keyed by completion id:
  visible conversations suppress notices; genuine background success uses a
  short info toast, failure uses an error toast, and the rail keeps
  `Done`/`Failed`/`Stopped` until that conversation is opened. Duplicate
  delivery for one run must not reopen notification eligibility.

- A conversation key is `scopeSessionStoreId(scope) + sessionId`; the store
  mapping is `shared/conversation-runtime.ts` (`conversationKey`).
- Runtime queue/abort/clarification/persist are exercised in
  `conversation-runtime/conversation-runtime.test.ts` and
  `conversation-runtime/service-conversation-runtime.test.ts` (parallel runs,
  per-conversation isolation, same-conversation serialization, delta streaming).
- Renderer store + switch-only-selector + shared snapshot:
  `hooks/conversationStore.test.ts`, `hooks/useChatStream.keyed.test.tsx`,
  `hooks/useChatStream.shared-snapshot.test.tsx`,
  `hooks/useChatComposerStateKeyed.test.tsx`.
- Session hydration is always qualified by `{ scope, sessionId }`; fetched
  messages are written to that conversation store BEFORE React adopts its
  selector. An unqualified `onMessagesLoaded(messages)` callback can capture
  the previous key and recreate the false New Chat empty state.
- Persisted hydration is rejected while that conversation's renderer snapshot
  is running. Disk intentionally lags the live turn until completion; replacing
  the live list would drop the current user message and make later deltas merge
  into an older assistant. Stream text and completion target the turn-owned
  assistant index rather than whichever assistant happens to be last.
- Navigation keeps requested and committed conversation keys separate. Rail
  selection and the visible body commit together only after hydration; failed
  loads retain the previous committed conversation. A pending navigation
  effect is keyed by its intent, not by callback identity: renderer state
  updates during hydration must not restart the same `loadSession` request.
  Per-turn IPC listeners are released on every terminal path.
- The conversation input contract carries request context, attachments, and
  mentioned workspaces through renderer → IPC → runtime → engine. Persistence
  retains user context/attachments and assistant tools, run id, and role
  metadata; a persistence failure is a failed turn, never an empty success.
- Conversation-runtime reads and full-state writes use the same per-scope
  `SessionMutationCoordinator` tail as load/new/delete. Its run lease remains
  active through persistence, so pointer changes cannot redirect a completed
  turn and deletion cannot resurrect a running conversation. Run controls
  always address the selected conversation key.
- The local E2E model uses the Responses API (`POST /v1/responses`), matching
  `createOpenAI(...)`'s default model path. `harness/mock-llm.test.mjs` pins a
  non-empty streamed response; conversation failures must remain `ok:false`
  through runtime → service → IPC instead of rendering an empty success.

## Loading-state flags

Three flags look similar and are not interchangeable.

- `sessionsLoading` — the session LIST is being fetched. Drives the rail
  spinner in `ChatSessionsRail.tsx` and the panel dropdown in
  `ChatHeader.tsx`.
- `sessionLoading` — THIS conversation's messages are being fetched. Drives
  `ChatThreadSkeleton.tsx` in place of the thread, rendered via `ChatView` →
  `ChatMessages`.
- A third, unrelated flag: the stream hook's `loading` (from
  `useConversationRuntimeStream` via the conversation store snapshot) means
  "the model is generating". That one drives the three-dot `.chat-loading`
  indicator, never the skeleton.

`sessionsLoading` and `sessionLoading` both live in `hooks/useChatSessions.ts`
(`src/renderer/src/components/chat/hooks/useChatSessions.ts`). Do not
conflate them.

**`runThreadFetch` and the request token.** Every thread-replacing IPC call —
`getHistory`, `loadSession`, `loadCrossWorkspaceSession` — MUST go through
`runThreadFetch`. It owns the `sessionLoading` flag AND a monotonic request
token that drops superseded responses. Without it, two quick session picks
let the slower one overwrite the session the user actually chose.
`handleNewSession` must keep bumping that same token so an abandoned load
can't repaint a blank new chat over whatever the user has since switched
into.

**Cold history is independent of Agent startup.** `canvas-agent:history` reads
the visible thread and active session id from `history-snapshot.ts`, then warms
the tool-capable Agent in the background. It must not await Engine, Skill, or
MCP initialization: installing remote plugins can make that startup take many
seconds, while reading the local session is fast and does not require tools.
The cold reader peeks the same useful current/latest-archive session that
`restoreLastSession()` will later adopt, without moving the durable pointer.
Send and session-mutation paths still await single-flight scope activation.
Guards: `src/main/agent/__tests__/service-history.test.ts` and
`src/main/agent/__tests__/session-store.test.ts`.

**Seeding.** `sessionLoading` is seeded TRUE at mount. Effects run after
first paint, so a false seed would flash the empty state before the fetch
even starts. `skipInitialHistory: true` therefore OBLIGES the caller to call
`handleLoadSession` itself — with the initial history fetch skipped, nothing
else will ever clear that seeded-true flag.

**Submit veto.** Sending is vetoed while `sessionLoading` is true — the same
rule that already blocks session switches while streaming. The veto is
implemented in `useMentions`' `isSubmitBlocked`, not at a single call site,
because the composer has TWO submit paths: the send button and
`handleKeyDown`'s Enter key. A guard placed only in a caller's `handleSubmit`
is a hole — one of the two paths would bypass it.

Tests: `hooks/useChatSessions.test.tsx`,
`hooks/useMentions.submit-veto.test.tsx`, `__tests__/ChatSessionLoading.test.tsx`
(all under `src/renderer/src/components/chat/`).

## Stopped-turn outcome lifecycle

A stopped turn keeps a compact recovery marker while it remains the latest
user-visible outcome. Once a later user message moves the conversation on,
that old marker is hidden; the partial assistant content stays in history.
Failed-turn outcomes remain visible because their diagnostics and retry state
are still relevant. Guard: `__tests__/ChatMessages.accessibility.test.tsx`.

## Stable full-page session rail

The full-page rail is a unified, cross-scope index. Its folder tree must stay
structurally stable while the selected conversation changes scope.

- With `allWorkspaces` present, `listAllSessions` is the single list source;
  do not also fetch `listSessions` and reconcile two snapshots of the same
  store.
- `sessionsStoreId` records which scope produced the committed `sessions`
  array. During a cross-scope thread load it can intentionally differ from
  `agentScope`; `useStableSessionRail` must group rows by this committed owner,
  never re-label them using the destination scope early.
- Folder collapse state is user state. Reconciliation may initialize a new
  folder or expand the active folder, but must preserve manually expanded
  siblings and manually collapsed active folders; it must not mutate state
  merely because search filtered or refreshed a folder. Large folders preview
  ten sessions with explicit progressive disclosure so one scope cannot push
  the rest of the rail out of view; the current session stays in that preview.
- While a conversation opens, keep the rail visible and mark only the pending
  row busy through `aria-busy`; do not dim the rail or swap in a transient
  spinner. The full-page body must not add an in-flow opening banner: even a
  one-frame banner shifts the entire thread. Disabling or replacing the whole
  rail destroys spatial context.
- Session and group recency use exact `updatedAt`; the calendar date is only a
  compatibility fallback. Main excludes active session stores from the global
  disk scan because their live agents supply the authoritative list.
- An empty current pointer is a composer draft, not history: `listSessions`,
  active-agent group reconciliation, and disk scans omit it. Starting New chat
  while that pointer is empty reuses it, so repeated clicks do not manufacture
  invisible rows.
- The full-page rail and top-right New chat controls immediately start an
  unassigned draft; they never ask for workspace metadata before the user can
  type. Only a real workspace row's `+` starts a workspace-owned draft. An
  unassigned draft has no placeholder workspace label in the topbar, while a
  workspace-owned draft shows that workspace's real name. Delivery feedback
  calls the unassigned destination AI Chat rather than exposing the internal
  `No workspace` scope label. A cross-scope draft creates the target pointer
  before the body switches scope and focuses the composer after adoption;
  intent ordering prevents a slower earlier request from replacing a newer
  destination click.

Guards: `hooks/useChatSessions.test.tsx` composes cross-scope loading with the
unified rail and pins the one-source list contract;
`__tests__/ChatSessionsRail.test.tsx` pins expansion preservation, pending-row
feedback, the title-only row layout, precise recency ordering, and workspace
row draft actions;
`src/main/agent/__tests__/service-history.test.ts` pins active-store exclusion.

### Dock chat session switcher

The dock header's session menu shows the current scope's recent sessions and,
when cross-scope rows plus `onOpenSessionInScope` are available, lists
conversations owned by other workspaces directly below them. Selecting an
other-workspace row closes the menu and delegates to
`onOpenSessionInScope`, which switches to that conversation's owning scope and
lets the target scope load the selected session; it must not call
`handleLoadSession` with the source workspace id, because that path imports the
conversation into the current scope. Copy is intentionally not exposed in this
menu for now. Guard:
`__tests__/ChatHeader.cross-scope.test.tsx`.

## Full-page chat topbar vs dock content tabs

The full-page chat topbar (`chat/ChatPageBody.tsx`, shared by the AI Chat
page and a scheduled task's chat page) has NO close button. Its right-most
control instead shows/hides the dock's CONTENT tabs (link / artifact /
node-detail / canvas-preview) beside the chat, and must never navigate — a
control that routes away from the page the user is reading is not a panel
toggle.

`RightDock/dock-content-tabs.ts` owns that switch, via
`store.toggleContentTabs`:

- `openChat` / `toggleChat` cannot serve these routes, because the tab they
  target (the chat/terminal tab) is hidden on this route.
- An expanded dock still pointing at the chat/terminal tab must be
  re-pointed at a content tab rather than collapsed — collapsing instead
  would make the first click read as a no-op.
- The button stays visible and actionable even when no content tab exists.
  Its first click opens the scoped workspace canvas in preview mode
  when possible; global/scheduled scopes and an already-mounted canvas create
  a blank browser tab instead. Its topbar position must not jump as tabs land.

**Inset rule.** These routes reflow like any other route, through
`reserveSpace` — the dock inset must NOT be gated on `chatTabEnabled`. Gating
it on `chatTabEnabled` is what previously let a link tab overlay and cover
the AI Chat page.

**Exits.** Esc and ⌘/Ctrl+Shift+L remain the exits from the AI Chat route.

Tests: `RightDock/__tests__/dock-content-tabs.test.ts`, plus the no-chat-tab
inset case inside `RightDock/index.test.tsx`.

### Canvas-tab editing host boundary

Canvas tabs always open in preview mode. Only the dedicated `/chat` AI Chat
route may show an explicit Edit action; canvas tabs in the workspace dock,
scheduled-task chat, Nodes, Skills, and plugin routes remain read-only. The
capability is derived from the current route and passed through App →
RightDock → DockPanes → CanvasPreview. It is never persisted on the tab, so a
retained tab drops back to preview synchronously when its host changes and a
later return to AI Chat does not revive the old edit session.

Edit mode mounts the canonical `Canvas` implementation rather than teaching
the snapshot preview to mutate. This preserves nodes+edges history, save
failure handling, updatedAt merging, flush-on-unmount, and undo/redo. The dock
viewport is local: it auto-fits the pane and never overwrites the workspace's
main-canvas transform; node-only saves retain the transform loaded from disk.
The editor reports both full node and edge snapshots back to the preview so
leaving Edit never flashes stale structure while the persisted reload lands.
The existing mounted-workspace guard remains the one-writer boundary: a live
Workbench canvas cannot also open as a dock canvas, and mounting that workspace
closes its dock tab. Because Workbench is route-keep-alive, off-route canvases
must also receive `isActive=false` so their global keyboard/paste handlers do
not compete with the visible dock editor. Inside AI Chat, a visible dock Canvas
keeps `isActive=true` for node lifecycles but owns keyboard/paste only after the
latest pointer or focus interaction occurred inside it; focusing Chat releases
those document-level handlers without unmounting the editor.

DOM review comments created inside an editable iframe node use the same active
Chat-target broker as node, DOM-selection, and Tab context. The full-page Chat
composer registers the review submission handler, so reviews never fall through
to a hidden workspace composer while `/chat` is visible.

Guards: `RightDock/__tests__/dock-chat-availability.test.ts`,
`RightDock/index.test.tsx`, `RightDock/__tests__/DockPanes.test.tsx`,
`RightDock/__tests__/CanvasPreview.test.tsx`,
`Canvas/hooks/useCanvasSyncEffects.test.ts`, `hooks/useNodes.test.tsx`, and
`Workbench/__tests__/ChatDockLifecycle.test.tsx`. Review routing is pinned by
`chat/__tests__/ChatPage.dom-review.test.tsx`,
`chat/hooks/useSubmitDomReviewComments.test.tsx`, and
`Workbench/__tests__/useChatInsertionBridge.test.tsx`.

### Explicit Chat ↔ dock-tab context

A content tab being visible beside Chat is never implicit model context. The
user must add it through `@Tab` or the tab's Ask AI action. Full-page Chat
initially binds the dock to the visible conversation's workspace scope, so its
Tabs are published under that Workspace and are never merged with another
Workspace's tab session. Global and scheduled conversations do not own a tab
session; the renderer publishes the Workspace currently hosting the visible
Dock as a route. Interactive Global browser tools can omit `workspaceId` to
operate that route, or pass an explicit `workspaceId` to target another
isolated Workspace. Canvas/node/resource operations still require an explicit
Workspace target in Global Chat. A qualified tab reference may explicitly move
the dock to that tab's owning workspace without changing the conversation
scope; the next conversation switch binds it to the newly selected conversation
again. Candidates are built from the dock's actual `activeTerminalWorkspaceId`,
including after that explicit override.

Every node / DOM-selection / whole-tab dock-to-Chat action awaits a
`ChatDeliveryReceipt` and reports delivered, queued, unavailable, or failed
against its real target; a missing callback is never success.

Session citation markers are atomic Markdown inputs: protect the complete
`@[session:<storeId>:<sessionId>:<messageIndex?>|<label>]` marker before
Markdown rendering, then restore it for chip conversion. Store ids such as
`__global_chat__` and `__scheduled__-<taskId>` must reach the chip dataset
verbatim; repairing rendered `<strong>` fragments after the fact is not a
compatible parser. Guards: `utils/mentions.test.ts` and
`__tests__/ChatMessages.accessibility.test.tsx`.

If the visible page composer is temporarily busy or registering, its context
insertion stays queued for that same composer instead of falling back to a
hidden dock composer. Whole-tab actions reuse `AgentContextTabRef` and the
shared `TabChatAction` rather than creating a second insertion path.

Tab mention markers retain `dockWorkspaceId` plus kind-specific resource
identity. Transcript chips switch to the owning workspace before activation;
if a cited web tab was closed, the dock deterministically reopens its persisted
URL and returns a distinct `reopened` receipt. Legacy or unsupported references
remain visibly stale rather than falling back to whichever tab is active.
Activation is acknowledged by the dock, so Chat shows progress/success instead
of failing silently. The composer also states its canvas capability:
global scope can edit a canvas only through explicit-target tools carrying a
workspaceId, while workspace scope has an ambient canvas target.
Editable composers expose `Automatic` / `Ask first`; Ask first is not advisory
copy — the main-process tool policy permits reads but gates mutating/command
tools through the clarification approval lane before execution.

Guards: `utils/chatPageDockTabs.test.ts`, `utils/mentions.test.ts`,
`__tests__/ChatMessages.accessibility.test.tsx`, and
`__tests__/ChatInput.execution-attachments.test.tsx` under
`src/renderer/src/components/chat/`, plus
`RightDock/useDockAgentBridge.test.tsx`.

## Dock width policy

`RightDock/dock-width.ts` (`src/renderer/src/components/dock/RightDock/dock-width.ts`).

- On the canvas, the dock may grow to ~95% of the viewport — the canvas
  reflows behind it, so a near-full-screen dock is legitimate there.
- Every page route caps it by both the 70% ratio and a shell-aware remainder
  (`min(viewport * PAGE_MAX_VIEWPORT_RATIO, viewport - pageMinAppWidth)`).
  `App` supplies the current sidebar width plus a 440px route-content floor.
  At a 1200px viewport the maximum is therefore 520px with the 240px sidebar
  open, or 712px with its 48px rail; the page itself keeps about 440px in both
  states. Ratio-only clamping used to permit an 840px dock and leave the app
  in a 312px gutter even with the sidebar collapsed.
- Full-page Chat changes its session rail to an overlay with a ChatPage
  **container query**, not a window media query. The dock changes the page's
  actual inline size without changing `window.innerWidth`; viewport-only
  breakpoints therefore miss exactly the squeezed side-by-side state.

**Two layers, kept separate.**

- `chosenWidth` — the dragged + persisted width the user chose.
- The rendered `clampDockWidth(...)` output — derived per route from
  `chosenWidth`.

Clamping the STORED value (`chosenWidth`) would silently discard a wide
canvas-mode dock width the first time the user opens a page route. Only the
rendered width is clamped; the stored preference survives a
canvas → page → canvas round trip untouched.

**Stable clamp identity.** The clamp function handed to `useDockSplitView`
must keep a STABLE identity — it is an effect dependency, and a per-route
identity would re-clamp on every navigation.

**Animation.** `.right-dock` animates `width` on the same curve as
`.app-body`'s `margin-right`, so a route switch moves the page edge and the
dock edge together. Drag-resize opts out of that animation via the
`.right-dock-resizing` class.

Tests: `RightDock/__tests__/dock-width.test.ts`, plus the capped-render case
inside `RightDock/index.test.tsx`.

## Main-side session integrity

`src/main/agent/service.ts` (`CanvasAgentService`) and its collaborators keep
one authoritative run and one session pointer per chat scope even when the
renderer fires concurrent, overlapping requests at it.

### Chat latency trace

The existing `canvas-agent-debug-trace` experimental feature records a bounded
performance breakdown for each native-runtime segment: session-lane wait, scope
activation (including a cold engine initialization), Canvas context/prompt
preparation, runtime-start delay, first stream activity, first text (TTFT),
runtime execution, Canvas response processing, and end-to-end duration. The trace is created only when the
feature is enabled and is shown in both the inline Debug Trace card and the
Agent Debug page; it adds no prompt or response content beyond the snapshots
that feature already owns. Timing starts in `CanvasAgentService.chatWithScope`,
so renderer prepare/subscribe IPC and the prepared turn's model-resolution call
are outside the reported end-to-end duration. Key contracts:
`src/main/agent/debug-trace.ts`, `src/main/agent/service.ts`,
`src/main/agent/canvas-agent.ts`, and
`src/main/agent/engine-stream-callbacks.ts`. Guard:
`src/main/agent/debug-trace.test.ts`.

Each trace records the runtime selected at the segment boundary. DevTools labels
the host-owned phases as `Canvas host` and the runtime-owned stream phases as
`Engine` or `Pi`; this follows `resolveAgentRuntime`'s actual result, so Pi being
enabled does not mislabel persona-role segments that still route to Engine.

### Single-flight scope activation

Canvas Agent scope activation must stay single-flight in
`src/main/agent/service.ts`. Cold history starts background warming while
other entry points may request the same scope, so an unguarded
check-then-initialize would create duplicate engines and make session switching
visibly stall.

Guard: `src/main/agent/__tests__/service-history.test.ts`.

### Runs are session-anchored: parallel conversations per workspace

A run is anchored to the CONVERSATION session the renderer was showing when it
sent — `requestContext.expectedConversationSessionId` — not to the scope's
"current" pointer. Two different sessions in the same workspace can stream
concurrently; a second run against the SAME session is rejected. A run without
a conversation session (legacy callers, e.g. scheduled tasks) keeps the old
per-scope exclusivity and blocks everything in the scope.

- `ActiveChatRegistry` owns IPC-visible run identity/abort/reconnect, gated by
  `(scope, conversationSessionId)` via `reserve(sessionId, scope, conversationSessionId)`
  and `hasConversationSession`.
- `SessionMutationCoordinator` serializes chat runs per `(scope, conversationSessionId)`
  (`runChat(scope, op, conversationSessionId)`). Pointer mutations only block
  when the TARGET session is streaming: `new`/`branch`/`rewind`/`delete`/`import`
  of the running session return `CHAT_SCOPE_BUSY`; `load`/`rename`/`pin` are
  allowed during a run on another session (that is the parallel feature).
- `CanvasAgent` anchors each run through `prepareRunSession` (`run-session-context.ts`):
  it reads the target session (current or newest archive, without moving the
  pointer), builds an INDEPENDENT `runMessages` context, and persists via
  `appendToSession` (queued behind the coordinator's per-scope tail so it never
  races an archive/load). Abort/relay/clarification are per-session via
  `CanvasRunRegistry` keyed by conversation session id.
- Renderer scope activity is only a UX mirror of this main-side state; it is
  not itself authoritative. `useChatScopeActivity` treats a run on a DIFFERENT
  conversation as not-busy, so the current composer stays enabled.

**prepare → subscribe → start.** Current senders must use this three-step
sequence: prepare reserves the run before returning (passing the anchored
conversation session); start upgrades that reservation and freezes the
main-resolved model into the persisted turn snapshot. A reservation owns the
run's `AbortController`, so a hard Stop latches even before start.

**Deleted-conversation guard (replaces pointer CAS).** Because a run no longer
follows the live pointer, main no longer CAS-compares it at start. Instead the
renderer's `expectedConversationSessionId` IS the run's anchor: if that
conversation was deleted while the message was in flight, the turn returns
`CHAT_SESSION_CHANGED` with the authoritative current session id, and nothing
is persisted.

**Switching conversations while a run streams.** The rail stays usable: picking
another session calls `disposeCurrentTurn` (via `useChatPagePendingSession`'s
`onAbandonCurrentTurn`), which drops this surface's UI lease — `releaseScope` +
`resetTurnState` — so `loading` clears and the newly shown conversation can send
immediately. The old run continues main-side, session-anchored; this surface
unsubscribes from its transient stream events. `ActiveChatRegistry` journals
renderer-facing events with a monotonic sequence and retains a settled journal
briefly; switching back loads durable history first, then `chatRunReattach`
replays every event after its cursor. History must become the baseline BEFORE
replay starts — reversing that order lets a late history fetch erase newly
replayed deltas. Reclaiming the run also changes `busyElsewhere` from true to
false while main still reports `active:true`; that ownership transition is NOT
completion and must never trigger a history refresh. Only an explicit
`active:false` for the same conversation may reconcile durable history. Scope
changes (different workspace) already dispose the turn via the `scopeKey`
effect.

**User-facing expectation (what this feature is FOR).** The mental model is the
same as Claude Code / ChatGPT multi-conversation concurrency, scoped to one
workspace's chat:

```
① Session A: send a long task ("write the weekly report")   → streams
② Switch to session B in the rail (or open another existing one) → A keeps
   running in the background, session-anchored
③ Session B: send another task ("organize my notes")        → starts immediately,
   both conversations run in parallel
④ Switch back to A any time                                  → missed events replay
   and live output resumes; while it is still running the rail shows a
   "Running / 运行中" marker (useScopeRunningSessions)
```

Explicit boundaries a user will hit:
- **Same conversation stays serial.** Sending into A while A streams returns
  `CHAT_SCOPE_BUSY` ("Another reply is already running for this chat scope.").
  This is by design — a second turn in the same thread would corrupt context.
- **New-session stays available while streaming.** Because a run is
  session-anchored, creating a session archives the running conversation and
  the run keeps writing to its archived copy — verified end-to-end
  (`newSession` returns ok while `getScopeRunStatus` still reports the run
  active; the archived session gains the full turn). The rail's New-chat
  button is only disabled during a pointer swap (`sessionLoading`) or when
  another surface owns the current session (`busyElsewhere`), not while this
  surface merely has a stream in flight. Other pointer mutations
  (rewind/delete/branch) still reject a RUNNING session because they would
  destroy or fork the run's own thread.
- **One surface shows one stream.** After switching to B, A's output does not
  scroll on screen (it continues main-side and persists); switching back to A
  replays output emitted while it was hidden and resumes the live stream. The
  rail's Running marker is the "it is still working" affordance.
- **Parallel is within a workspace.** Different workspaces / global chat were
  already parallel; this feature adds the same guarantee for different
  conversations inside one workspace.

Verify with the mock stream: `PULSE_CANVAS_PERF=1
PULSE_CANVAS_PERF_INTERVAL_MS=250` keeps a `__pulse_perf_chat_stream__` turn
streaming ~2.5min, long enough to exercise the switch (see
`perf-chat-replay.ts` for the env overrides).

Renderer branch recovery must hand the acknowledged branch id to the send
path synchronously before React adopts the new session. Delayed branch results
are guarded by monotonic mutation, scope, and conversation epochs so a scope or
session switch — including leaving and returning — cannot overwrite the newly
visible thread.

Starting any renderer-side pointer mutation must also retire the active turn
lease synchronously. A late `prepareChat` or `startChat` result may dispose only
its own subscriptions; it must not release the scope or reset state owned by a
newer turn. Superseding a turn rolls its optimistic message suffix back to the
pre-turn baseline if the pointer mutation fails; authoritative branch messages
must update the synchronous message ref before their immediate replacement send.
While a branch mutation owns the pointer, ordinary composer sends are vetoed;
only that branch's replacement send may bypass the busy gate with its still-current
mutation generation.

Guards: `active-chat-registry.test.ts`, `prepared-chat.test.ts`,
`chat-protocol.test.ts`, and `__tests__/service-session-mutation.test.ts` (all
under `src/main/agent/`), `useChatScopeActivity.test.tsx`,
`useChatPagePendingSession.test.tsx`, `useChatComposerState.session-handoff.test.tsx`
`chatRunReattach.test.ts`, `useChatRunReattach.test.tsx`, and
`useConversationBranching.test.tsx` under renderer chat hooks.

### Input during a running turn

Run input is host-managed and therefore works for every runtime, including
Engine and Pi. While a turn runs, the normal send arrow queues the draft and
the accepted message appears in a compact row above the composer. Each row can
be removed or Steered; Steer moves it ahead of follow-ups, stops the active
turn, and sends normally after stop completion. Queue otherwise waits for the
active turn to settle, then uses the ordinary prepared-turn path.
Pending text and its context snapshot are kept by scope + conversation across
chat-surface remounts. Delivery pauses while that conversation has no mounted
chat host and resumes when it returns; it is not a durable app-restart queue.
Manual Stop clears pending input. Draft attachments stay untouched because run
input is text-only. Guards: `hooks/useChatRunQueue.test.tsx` and
`hooks/useChatStream.protocol.test.tsx`.

### Clarification serialization

The renderer has one visible approval card, so main must serialize
concurrent clarification requests and start each timeout only when that
request becomes visible. Answering one request must reveal, not clear, the
next queued request.

Guard: `clarification-registry.test.ts`
(`src/main/agent/clarification-registry.ts`).

### Fail-closed conversation pointer changes

Conversation pointer changes are fail-closed.

- Archive publication and the replacement current-session write must
  complete before the in-memory pointer advances.
- Queued persistence failures must remain observable through `flush()`,
  while the serialization tail stays usable for repair.
- Archive filenames must remain collision-safe even when timestamps and
  titles match.
- Once a promoted session is durably current, cleanup of its stale archive
  copies is best-effort: a cleanup failure must not report that the already
  committed pointer change failed.
- Deleting the current session reverses that order: stale data copies are
  removed before publishing the replacement pointer, while post-commit
  metadata cleanup is best-effort.

Guard: `src/main/agent/__tests__/session-store.test.ts` (source:
`src/main/agent/session-store.ts`).

### Chat image upload bounds, attachment retention, failed-turn persistence

Chat image uploads are bounded again in main before a prepared run is
accepted.

- Explicitly removing a ready draft attachment deletes its saved file.
- Clearing a successfully sent draft must retain the file, because session
  history references it.
- Native runtimes must treat the context's final user frame as the complete
  model-facing current turn. It carries attachment paths and inspection
  guidance that the plain composer text does not; seed it zero times and
  prompt it exactly once, including for image-only turns.
- A failed turn must persist the live tool-call snapshot and settle
  unfinished tools so reload matches the streamed UI.
- The built-in Engine backend opts into `LoopOptions.errorMode: 'throw'` so a
  terminal Provider failure or `finishReason: 'error'` reaches Canvas
  failed-turn persistence instead of becoming assistant prose. Engine preserves
  a terminal stream error when the SDK later masks it with a no-output wrapper;
  its default return-string mode remains unchanged for other hosts.

Guards: `useChatAttachments.test.tsx`
(`src/renderer/src/components/chat/hooks/useChatAttachments.ts`),
`segment-execution.test.ts`, `chat-protocol.test.ts`, and
`chat-failure-persistence.test.ts` (all under `src/main/agent/`), plus
`src/main/agent/backends/pi-agent-harness-backend.test.ts`.

### Full-screen chat rail projection

The full-screen chat rail is one stable cross-scope projection.

- Do not swap per-scope list caches into it.
- Do not fetch a list while `loadSession` is promoting an archive — either
  path can duplicate/reorder rows under the pointer and move the scroll
  position.
- Commit the current and other lists together after promotion.

Guards: `useChatSessions.test.tsx` and `ChatSessionsRail.test.tsx` (both under
`src/renderer/src/components/chat/`).

### Stable chat-target fallbacks at the app root

Chat-target registration is synchronously observed at the app root. Props
that feed a mounted `ChatPanel` target or its registered handlers must use
stable empty-collection fallbacks. An inline `[]` makes the target
unregister and re-register on every broker-driven root render, reaches
React's maximum update depth, and clears the renderer.

Workbench's node and selection fallbacks are module constants, and are
covered by `Workbench/__tests__/ChatDockLifecycle.test.tsx`
(`src/renderer/src/components/shell/Workbench/__tests__/ChatDockLifecycle.test.tsx`).
Knowledge chat applies the same stable-fallback rule, but is NOT exercised by
that guard.

## Evidence

Primary regression suites live in:

- `src/renderer/src/components/chat/hooks/useChatSessions.test.tsx`
- `src/renderer/src/components/chat/hooks/useMentions.submit-veto.test.tsx`
- `src/renderer/src/components/chat/__tests__/ChatSessionLoading.test.tsx`
- `src/renderer/src/components/chat/__tests__/ChatSessionsRail.test.tsx`
- `src/renderer/src/components/dock/RightDock/__tests__/dock-content-tabs.test.ts`
- `src/renderer/src/components/dock/RightDock/index.test.tsx`
- `src/renderer/src/components/dock/RightDock/__tests__/dock-width.test.ts`
- `src/main/agent/__tests__/service-history.test.ts`
- `src/main/agent/active-chat-registry.test.ts`
- `src/main/agent/prepared-chat.test.ts`
- `src/main/agent/chat-protocol.test.ts`
- `src/main/agent/chat-session-cas.test.ts`
- `src/main/agent/__tests__/service-session-mutation.test.ts`
- `src/main/agent/clarification-registry.test.ts`
- `src/main/agent/__tests__/session-store.test.ts`
- `src/renderer/src/components/chat/hooks/useChatAttachments.test.tsx`
- `src/main/agent/chat-failure-persistence.test.ts`
- `src/renderer/src/components/shell/Workbench/__tests__/ChatDockLifecycle.test.tsx`
