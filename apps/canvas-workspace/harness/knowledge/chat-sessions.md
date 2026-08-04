# Chat sessions

Scope: the Canvas Agent chat surface's session lifecycle — renderer-side
loading states, the full-page chat route's relationship to the right dock's
content tabs, right-dock width behavior, and the main-process layer that
keeps one authoritative run and one session pointer per chat scope. Read this
before changing `hooks/useChatSessions.ts`
(`src/renderer/src/components/chat/hooks/useChatSessions.ts`), the full-page
chat topbar / dock content-tabs toggle, `RightDock/dock-width.ts`
(`src/renderer/src/components/RightDock/dock-width.ts`), or
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
- The button stays visible but disabled when no content tab exists yet (a
  tab can land mid-conversation, e.g. the agent opening an artifact or
  preview), and its topbar position must not jump around as that happens.
  `chat.noDockTabs` labels the disabled state.

**Inset rule.** These routes reflow like any other route, through
`reserveSpace` — the dock inset must NOT be gated on `chatTabEnabled`. Gating
it on `chatTabEnabled` is what previously let a link tab overlay and cover
the AI Chat page.

**Exits.** Esc and ⌘/Ctrl+Shift+L remain the exits from the AI Chat route.

Tests: `RightDock/__tests__/dock-content-tabs.test.ts`, plus the no-chat-tab
inset case inside `RightDock/index.test.tsx`.

## Dock width policy

`RightDock/dock-width.ts` (`src/renderer/src/components/RightDock/dock-width.ts`).

- On the canvas, the dock may grow to ~95% of the viewport — the canvas
  reflows behind it, so a near-full-screen dock is legitimate there.
- Every page route caps it at 70% via `capWidth`
  (`PAGE_MAX_VIEWPORT_RATIO = 0.7`; born at 0.5, widened in #893), because a
  page IS the content and a 95%-wide dock would leave a chat thread in a
  gutter.

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

Guards: `active-chat-registry.test.ts`, `prepared-chat.test.ts`,
`chat-protocol.test.ts`, `chat-session-cas.test.ts`, and
`__tests__/service-session-mutation.test.ts` (all under `src/main/agent/`).

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

Guards: `useChatAttachments.test.tsx`
(`src/renderer/src/components/chat/hooks/useChatAttachments.ts`),
`chat-protocol.test.ts`, and `chat-failure-persistence.test.ts` (both under
`src/main/agent/`), plus
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
(`src/renderer/src/components/Workbench/__tests__/ChatDockLifecycle.test.tsx`).
Knowledge chat applies the same stable-fallback rule, but is NOT exercised by
that guard.

## Evidence

Primary regression suites live in:

- `src/renderer/src/components/chat/hooks/useChatSessions.test.tsx`
- `src/renderer/src/components/chat/hooks/useMentions.submit-veto.test.tsx`
- `src/renderer/src/components/chat/__tests__/ChatSessionLoading.test.tsx`
- `src/renderer/src/components/chat/__tests__/ChatSessionsRail.test.tsx`
- `src/renderer/src/components/RightDock/__tests__/dock-content-tabs.test.ts`
- `src/renderer/src/components/RightDock/index.test.tsx`
- `src/renderer/src/components/RightDock/__tests__/dock-width.test.ts`
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
- `src/renderer/src/components/Workbench/__tests__/ChatDockLifecycle.test.tsx`
