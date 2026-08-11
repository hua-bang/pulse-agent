# Chat sessions

Scope: the Canvas Agent chat surface's session lifecycle — renderer-side
loading states, the full-page chat route's relationship to the right dock's
content tabs, right-dock width behavior, and the main-process layer that
keeps one authoritative run and one session pointer per chat scope. Read this
before changing `hooks/useChatSessions.ts`
(`src/renderer/src/components/chat/hooks/useChatSessions.ts`), the full-page
chat topbar / dock content-tabs toggle, `RightDock/dock-width.ts`
(`src/renderer/src/components/dock/RightDock/dock-width.ts`), or
`src/main/agent/service.ts` and its collaborators (`active-chat-registry.ts`,
`session-mutation-coordinator.ts`, `prepared-chat.ts`, `chat-session-cas.ts`,
`clarification-registry.ts`, `session-store.ts`,
`chat-failure-persistence.ts`, `useChatAttachments.ts`).

## Loading-state flags

Three flags look similar and are not interchangeable.

- `sessionsLoading` — the session LIST is being fetched. Drives the rail
  spinner in `ChatSessionsRail.tsx` and the panel dropdown in
  `ChatHeader.tsx`.
- `sessionLoading` — THIS conversation's messages are being fetched. Drives
  `ChatThreadSkeleton.tsx` in place of the thread, rendered via `ChatView` →
  `ChatMessages`.
- A third, unrelated flag: `useChatStream`'s `loading` means "the model is
  generating". That one drives the three-dot `.chat-loading` indicator,
  never the skeleton.

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

Guards: `hooks/useChatSessions.test.tsx` composes cross-scope loading with the
unified rail and pins the one-source list contract;
`__tests__/ChatSessionsRail.test.tsx` pins expansion preservation, pending-row
feedback, the title-only row layout, and precise recency ordering;
`src/main/agent/__tests__/service-history.test.ts` pins active-store exclusion.

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
The existing mounted-workspace guard remains the one-writer boundary: a live
Workbench canvas cannot also open as a dock canvas, and mounting that workspace
closes its dock tab. Because Workbench is route-keep-alive, off-route canvases
must also receive `isActive=false` so their global keyboard/paste handlers do
not compete with the visible dock editor.

Guards: `RightDock/__tests__/dock-chat-availability.test.ts`,
`RightDock/index.test.tsx`, `RightDock/__tests__/DockPanes.test.tsx`,
`RightDock/__tests__/CanvasPreview.test.tsx`,
`Canvas/hooks/useCanvasSyncEffects.test.ts`, `hooks/useNodes.test.tsx`, and
`Workbench/__tests__/ChatDockLifecycle.test.tsx`.

### Explicit Chat ↔ dock-tab context

A content tab being visible beside Chat is never implicit model context. The
user must add it through `@Tab` or the tab's Ask AI action. Full-page Chat
builds those candidates from the dock's actual `activeTerminalWorkspaceId`,
not from the conversation scope: global Chat and a historical cross-workspace
conversation may both sit beside a different workspace's live dock.

Every node / DOM-selection / whole-tab dock-to-Chat action awaits a
`ChatDeliveryReceipt` and reports delivered, queued, unavailable, or failed
against its real target; a missing callback is never success.
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
global scope is canvas-read-only, while workspace scope can edit its canvas.
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

### Single-flight scope activation

Canvas Agent scope activation must stay single-flight in
`src/main/agent/service.ts`. Chat entry concurrently requests history and
session lists, so an unguarded check-then-initialize would create duplicate
engines for one scope and make session switching visibly stall.

Guard: `src/main/agent/__tests__/service-history.test.ts`.

### One authoritative run, one session-mutation lane

One chat scope has one authoritative run and one session-mutation lane.

- `ActiveChatRegistry` owns IPC-visible run identity/abort/reconnect.
- `SessionMutationCoordinator` serializes chat against
  new/load/branch/delete/rename/pin/import mutations.
- Renderer scope activity is only a UX mirror of this main-side state; it is
  not itself authoritative.

**prepare → subscribe → start.** Current senders must use this three-step
sequence: prepare reserves the scope before returning; start upgrades that
reservation and freezes the main-resolved model into the persisted turn
snapshot. A reservation owns the run's `AbortController`, so a hard Stop
latches even before start.

**Compare-and-swap (CAS) on the session pointer.** The renderer also sends
its visible conversation-session id. After the mutation lane goes idle, main
must compare-and-swap that pointer before calling the agent, and return the
authoritative history on mismatch.

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
`chat-protocol.test.ts`, `chat-session-cas.test.ts`, and
`__tests__/service-session-mutation.test.ts` (all under `src/main/agent/`), plus
`useChatComposerState.session-handoff.test.tsx` and
`useConversationBranching.test.tsx` under renderer chat hooks.

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
