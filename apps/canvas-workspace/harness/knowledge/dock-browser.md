# Dock browser behavior

The RightDock link tab is an embedded browser surface, not just another React
preview. Its page runs in a separate Electron `<webview>` WebContents, so host
DOM focus, keyboard events, navigation policy, and guest lifetime all require
explicit contracts.

## Surface and navigation policy

Every mounted guest registers a `WebviewRegistration` from
`src/shared/webview-registration.ts` with all of:

- `surfaceKind`: `dock-browser` or `canvas-node`;
- `workspaceId`;
- `nodeId` (the dock tab id for a dock browser);
- `webContentsId`.

The main-process registry is indexed by both node identity and WebContents id.
More than one presentation of the same canvas node may be alive (for example,
the canvas card and its dock detail), so every WebContents remains registered;
the node lookup selects the newest live presentation and falls back when it is
removed. Cleanup is generation-safe: a stale guest being destroyed must not
remove the newer guest that replaced it.

`useEmbeddedBrowser` initially mounts a gated guest on `about:blank` and does
not release its real URL until registration of that exact WebContents succeeds.
This ordering is load-bearing: an instant page redirect must never reach link
policy before main knows the guest's surface and full identity.

`main/app/link-policy.ts` uses `surfaceKind` as the policy boundary. A safe
HTTP(S) cross-origin navigation in a `dock-browser` remains in the current tab,
like a normal browser. A `canvas-node` remains a preview: its cross-origin
navigation becomes a dock link. OAuth redirects and external editor protocols
retain their dedicated policies.

Only a registered `dock-browser` guest receives browser shortcut interception
from `main/app/webview-shortcuts.ts`. Canvas-node pages keep owning their
keystrokes.

## Link-open identity and workspace routing

`link:open` carries both the legacy `sourceWebContentsId` and the full source
registration. The renderer accepts it only when the full identity exactly
matches a currently mounted guest in `IframeNodeBody/webview-identities.ts`.
It must not guess the active workspace or resolve a tab from a bare id.

The source workspace owns the new tab even if another workspace became active
before the event arrived:

- active source workspace: open normally, beside its dock opener when one
  exists;
- retained source workspace: update its retained session without activating
  it;
- persisted-only source workspace: update its persisted dock session, then
  restore it when that workspace becomes active.

Chromium `background-tab` disposition never steals focus. Foreground opens
activate the resulting tab and focus that tab, while source-restoring menu
actions focus the opener only when they do not navigate away from it.

Right-dock sessions are isolated per chat scope. Full-page Workspace Chat
uses that Workspace's session (shared with its Canvas); Global Chat uses
`__global_chat__`, never the previously selected Canvas. All preview kinds,
not only links, belong to the Dock scope in which they were opened. Resource
workspace ids on artifact/node/canvas previews still identify their source.
The in-memory scope view restores mixed tab order, actual selected tab,
comparison panes, and chat state; web metadata and expansion remain durable.
Terminal tabs require a real Workspace and are not offered in Global.

Transcript citations from another scope open a resource preview in the current
Dock instead of switching its scope. Unsupported references (notably live
terminals without a reconstructible preview) return stale. Exact main-process
tab activation still targets the owning live instance; full-page Chat rejects
a cross-scope activation rather than silently overriding the conversation.
Global browser tools use the published visible Dock scope when `workspaceId`
is omitted. Explicit ids keep their qualified lookup; tab lists never merge
scopes.

## Guest lifetime

Restored/cold link tabs mount lazily: only a visible dock page is mounted for
the first time. Collapsing the dock must not cold-mount hidden pages. Once a
guest has mounted it remains resident through tab switches, dock collapse,
and bounded cross-workspace retention. L3 Memory Saver may later discard an
eligible long-frozen guest: clean reloadable pages restore their freeze-time
URL and scroll position, while dirty or non-reloadable pages fail closed and
remain resident.

Frame-rate, freeze, and discard requests carry the exact `webContentsId`, not
only the node alias. Freeze/active debugger transitions are serialized per
guest and use last-intent-wins cancellation around snapshot work, so a late
two-command freeze cannot land after a newer resume or identity rebind.
Agent DOM extraction uses the same lane when it temporarily resumes a frozen
guest and re-freezes only while its lease is still current; a user activation
during the read always wins.

Snapshot captures are time-bounded by design. The freeze IPC once awaited a
bare `wc.capturePage()` on a hidden guest — a guest producing no frames never
settles that promise, which wedged the IPC reply, and the discard sweep's
identical fallback would have latched its re-entrancy flag forever, killing
all future sweeps. Every capture now goes through the 2 s-bounded
`captureBoundedSnapshot` (`src/main/webview/snapshot.ts`), pinned by a
never-settling-capture regression test. Never await Electron `capturePage`
unbounded on a possibly-hidden or occluded webContents.

The shared Electron Profile also has background cache capacity maintenance
(`src/main/app/profile-cache-maintenance.ts`). Thirty seconds after the first
window opens, at most once per 24 hours, it measures only HTTP Cache, Code
Cache, and Service Worker CacheStorage; above the default 2 GiB threshold it
clears those reproducible stores through Electron's Session APIs. Cookies,
LocalStorage, IndexedDB, File System, auth cache, and browsing history are
never included, so login-bearing state survives. Configure or disable with
`PULSE_CANVAS_PROFILE_CACHE_MAX_MB` (`0` disables),
`PULSE_CANVAS_PROFILE_CACHE_CHECK_HOURS`, and
`PULSE_CANVAS_PROFILE_CACHE_DELAY_MS`. The maintenance state file is atomic
and the work stays off the startup critical path.

`DockPanes` renders live and retained pages from one stable, key-sorted list.
Do not split them into separate sibling lists or move a `<webview>` within its
parent; either operation can cause Chromium to recreate the guest. Hidden
guest navigations must write through to retained state so restore does not
navigate back to a stale URL.

`DockPanes` gates `LinkTabView`'s `mountWebview` prop on that same visibility
check — the concrete mechanism behind first-mount laziness, so a restored
dock does not spawn one guest process per tab on the cold-start path. Agent
tools that activate a tab before reading it must poll for registration via
`main/webview/ensure-operable.ts` rather than assume the guest already exists.

## Focus and keyboard ownership

`RightDock/dock-browser-commands.ts` owns workspace-and-tab-qualified focus
intents. A focus request persists until the exact guest exists; it is canceled
when a different target becomes active or the dock is hidden. This is needed
for blank-tab address commits and retained guest replacement, where a
short-lived timeout races normal mounting.

Address, reload, and find commands are also qualified by workspace and tab.
The active `LinkTabView` ignores commands for another guest. Find keeps a
monotonic request id, ignores stale results, and replays the current query when
its guest is replaced. Guest-focused Find is a cancellable default rather than
an unconditional host shortcut: `src/preload/webview-find.ts` observes the DOM
keydown through the webview preload, and sends `pulse:dock-find-fallback` only
when site code neither canceled the default nor stopped event propagation.
Both signals count because document apps such as Feishu may claim Find with
`stopPropagation()` alone. This gives those apps first refusal while ordinary
pages still receive the host find bar.
The bridge checks in the next task, not a microtask: Electron can flush an
isolated-preload-world microtask before page-main-world propagation resumes,
which observes a false unhandled state before Feishu's document listener runs.
The preload stays main-frame-only; do not enable Node preload execution in
untrusted child frames merely to broaden shortcut observation.

Browser chords are shared in `src/shared/dock-shortcuts.ts`. Guest-focused
chords are relayed by main; dock-chrome chords are handled by
`RightDock/useDockKeyboard.ts`. From dock chrome, Escape collapses an active
web tab without destroying its browsing state, closes a reconstructible
content/terminal tab, and leaves the pinned chat alone. Escape inside a web
page stays page-owned so sites can close their own dialogs or exit modes.
Dock-owned portals count as dock focus for scoped commands such as Find.

Main-process page-control input has one additional focus boundary: after
`Page.bringToFront`, CDP fill/press actions must focus the owning host
`<webview>` by the guest WebContents id. Guest DOM focus and `WebContents.focus()`
alone can leave Chromium's input route on the chat composer, causing
`Input.insertText` or key events to leak into host UI.

Read-only operations on a dock link tab must use its live registry entry
directly. They must not call `ensureOperable` when the guest is temporarily
unmounted, because its fallback activation changes the current workspace hash
route; return a retryable not-mounted result instead.

## Page-element selection bridge

Page-element selection in a dock browser tab must reuse the shared iframe
DOM picker/selection context, then route the result through Workbench's
active-workspace chat bridge. That bridge must queue selections until the
target composer registers — opening chat and retrying on the next animation
frame is not a reliable mount barrier.

## Tabs and discoverability

`RightDock/dock-tab-items.ts` is the single visible-tab projection used by the
strip, keyboard cycling, and the All Tabs menu. Hidden terminal sessions are
excluded consistently. Overflow is discoverable through the counted All
Tabs search dialog (title/URL filtering, domain labels, visible-pane labels,
recent activation order and workspace-scoped recently closed web tabs), and the pinned Pulse AI tab remains reachable at the start of the
strip rather than scrolling away with page tabs.

The strip and All Tabs search share one fixed 16px icon slot and the same Pulse,
terminal/agent, page-favicon, node-detail, or content mark. Keep favicon and
agent metadata in the projection rather than replacing every row with a
generic kind dot.

The pinned Pulse AI tab is `position: sticky; left: 0`, so the rest of the
strip scrolls *underneath* it. Every state it can paint (active, hover,
split-visible) must therefore end up fully opaque. The design tints are all
translucent, so each is composited as a gradient layer over an opaque
`var(--surface)` base rather than being used as the background outright — a
bare translucent background lets the tab passing behind show through and the
titles read as double-printed. Those chat-tab rules also have to restate the
whole `background` shorthand, because the generic `.right-dock__tab` rules
they override are more specific and a shorthand resets `background-color`.

Closed web tabs enter the bounded, workspace-scoped reopen stack. Reopen must
allocate a fresh id if the original id already exists; duplicate React keys or
guest identities are never permitted.

Dock expansion is workspace-scoped as well. Switching workspaces saves the
current workspace's expanded state and restores the target workspace's last
state from the same persisted dock session; a workspace without saved state
starts collapsed.

The dock comparison view is exactly two stable left/right panes, not a layout
tree. The toolbar opens a searchable target picker; choosing a tab puts the
current tab on the left and the chosen tab on the right. The picker excludes
the current tab and invalid pairs; AI is offered only where a Dock chat exists. Selecting an already-visible tab changes input focus; selecting any other
dock tab replaces the focused pane without moving the other one. Clicking
inside either pane sets that target; the focused border and tab underline
identify it. There is no fixed-right pin. The tab picker labels visible tabs
by their left/right position. Explicit tab-menu placement can select a side
without first focusing it; placing an already-visible tab on the other side
swaps the pair without duplicating guests. Exiting comparison keeps the left
pane even when focus was on the right. Closing
either visible content tab exits comparison and keeps the survivor. Two
terminal tabs are deliberately not paired because the renderer still owns one
shared terminal portal host; explicit two-terminal pairing is rejected. A normal terminal selection that
would require two terminal panes exits comparison and shows the selected
terminal alone.

The tab-strip expand/return and comparison icons add no extra toolbar row.
Reading expansion is layout-only (`useDockReadingLayout`): Canvas and full-page
chat can promote the same Dock to the main workspace width while retaining the
sidebar. Comparison also uses that width instead of permanently growing the
saved side-panel width. Return restores the original inset and side width;
manual expansion survives ordinary tab switching and comparison exit.
Full-page chat keeps its existing left conversation/right Dock layout for
single-page browsing. It supports content-to-content comparison through the
same picker and tab menu, but never offers a duplicate AI pane. Content-only
pairs survive route changes; an inherited AI pair exits while preserving the
left content tab. Comparison expands over the main work area without remounting
the underlying conversation; return restores the original layout. Covered route content is hidden and
inert while its mounted state and layout dimensions stay intact. Route/scope
changes do not promote an unrelated scope; collapsing clears manual promotion.
Guards: `__tests__/useDockReadingLayout.test.tsx`, `dock-reading-flow.test.ts`,
and `DockTabSwitcher.test.tsx` under RightDock.

Menus or suggestions above a guest must hold `useGuestInteractionShield`,
because guest clicks do not reach the host document. The shield observes guests
mounted while an overlay is already open; a one-time query silently misses a
cold tab that finishes mounting underneath it. A menu portaled from the dock
also needs the dock-menu layer class so it paints above `.right-dock`.

Electron's public context-menu `params.x/y` have already crossed the guest-to-
embedder boundary and are host viewport coordinates, even though Chromium's
internal context-menu data begins guest-local. Pass those values directly to
the fixed host portal; adding the webview host rect again double-offsets the
menu and can make viewport clamping push it far away from the click.

## Main-process tab registry and cross-surface pushes

`src/main/dock/` is the main-process side of right-dock tab support:

- `tab-store.ts` is the renderer tab mirror behind `dock_list_tabs`.
- `tab-actions.ts` sends the main→renderer workspace-scoped `dock:activate-tab`
  push behind `dock_activate_tab` and the page_* tools' tab targeting, the
  app-level `dock:open-tab` push behind `dock_open_tab`, and the app-level
  `dock:open-artifact` push used by the scheduled memory report — artifact
  `workspaceId` is a storage scope and may be the `__global_chat__` sentinel.
  Activation does not call `activateWorkspaceWindow`: the renderer selects the
  owning dock workspace where the host permits it, then replies on `dock:tab-activation-result`. Main reports success
  only after that acknowledgement; unavailable scopes and stale tabs fail.
  Full-page Chat keeps its conversation scope and refuses cross-scope activation.
- `history-store.ts` holds web-tab browsing history behind
  `browser_search_history`.

`tab-store.ts` also records the latest Dock Workspace published by the visible
renderer. Interactive Global browser tools use that value only as a default
route for the current Dock; it is not a storage scope and does not relax the
workspace-qualified registry lookup. `dock_open_tab` uses the same wrapper as
list/activate/read: its capability requires a workspace even though the renderer
open push is app-level. Interactive Global resolves an omitted id from the
visible Dock; scheduled/headless tools require an explicit id. Leaving open
unwrapped would send an empty workspace into the capability and strand the
agent before any `page_run` call. `tools-graph.test.ts` covers both routes.
Canvas/node/resource operations in Global
Chat continue to require an explicit `workspaceId`.

`RightDock/tabRefs.ts` is the renderer-side tab-discovery SSOT: it covers
link, artifact, node-detail, canvas-preview, and terminal tabs plus
active/visible/split state. Terminal commands use `dock_execute_terminal`.

## Bounded browser tasks (`page_run`)

The existing `webview-page-control` plugin also exposes deferred `page_run`
for interactive Workspace and Global chat. Global uses the same qualified
Dock routing as other `page_*` tools, resolved once at task entry. Scheduled
and headless tool factories do not inherit it. It does not open a browser or
switch to a newly opened tab: it pins the registered WebContents instance.

A popup forwarded through `link:open` is observed with the exact registered
opener identity after a concrete click/Enter. `page_run` returns `handoff`
and `openedPages` (workspace, URL, and tab ID when already published), so the
caller can read or continue in that tab instead of repeating the source-page
click. It does not automatically transfer execution or infer task completion.
Popup observation never changes the normal URL/activation policy.

The tool takes `nodeId`, `goal`, optional `mode` (`act` by default; `read` for
current-region-to-bottom traversal), optional `maxSteps` (20, range 1–60), and
`timeoutMs` (120000, range 1000–300000). Configure the TypeSafe Jev key in Settings → Tools, or supply
`TYPESAFE_API_KEY` in the Electron main-process environment. Saving applies
immediately to subsequent calls and reloads on app start; clearing restores
any original environment key. Without a key, the tool returns before
opening/observing a page or making a request. Optional
`PULSE_CANVAS_JEV_MODEL` defaults to `jev-latest`. Requests go directly to
TypeSafe's HTTPS systemone endpoint. The endpoint is fixed and cannot be changed in the tool settings.
The settings form clears its password draft after saving; status exposes
only key presence, source and length. Keys never enter page_run arguments,
traces or logs. Storage reuses existing built-in-tool local obfuscation,
not OS-backed encryption. Text entry uses the existing configured
Canvas model, separately from Jev; there is no keyword fallback.

`src/plugins/main/webview-page-control/page-run/` owns the loop, model adapter,
DOM snapshot and browser adapter. Fixed scripts run in isolated world 987 and
retain real DOM identities. Candidates distinguish directly hittable targets
from targets clipped by scrollable containers; fully covered controls are
excluded. A selected clipped target is identity-checked, scrolled into view,
then re-observed before any click or typing. This avoids demanding a click
hit before the scroll that makes the target hittable. Model choices are
restricted to observed click,
fill and Enter targets, Escape, scrolling, waiting, or returning control.
Native selects, arbitrary JS, coordinate guessing, frames, shadow roots and
automatic new-tab takeover stay outside this version. Filling never submits.
Snapshots also expose up to eight visible vertical scroll regions, ordered by
area, independently of the document root. Each scroll choice binds the actual
region node, semantic identity and observed scroll position; a fixed isolated
script rechecks these and scrolls atomically by 85% of the region viewport.
Replacement, occlusion or user scrolling before execution forces re-observation
or a specific failure. Scrolling the main reader never implicitly scrolls its
sidebar. Text observations respect ancestor overflow clipping. The document
scrollport uses viewport bounds: its root bounding box moves above the window
after scrolling while root clientHeight stays viewport-sized. Treating that
box as a nested clip hides valid text/targets on later screens; the root is
excluded from ancestor-box clipping and remains bounded by the viewport.

Every concrete mutation invokes the existing Canvas Ask-mode approval policy
with its own child call ID; an outer tool approval does not authorize unseen
child actions. These are host-policy calls, not nested Engine runs or full
Engine hook replay. Shared CDP primitives accept optional guards that recheck
cancellation, registration, URL policy, target identity/visibility, current
click hit-testing and keyboard focus before input. CDP work keeps using the
original WebContents mutex. Each guarded command and callback races its abort
signal; an unacknowledged input must release the queue on cancellation or
timeout instead of blocking all subsequent clicks. Late continuations cannot
send more input. Targeted freshness checks bind the document, actual node,
label/href, value and related form fields; unrelated carousels, counters and
recommendations do not invalidate them. Wait/Escape need the same
document; scrolling additionally checks its region and position. Completion
still uses the full snapshot check. Pre-input stale/reveal outcomes return to observation inside the same run,
bounded by three consecutive recovery attempts. A dispatch marker includes
field clearing, pointer-down and key-down; errors after that marker are never
automatically replayed. Cancellation prevents subsequent input but cannot undo an
already dispatched browser event. Only one page_run can own a guest at once.

The Jev adapter sends target metadata once and keeps its entire serialized
request within a conservative 28,000 UTF-8 byte budget, below Jev's documented
32k-token state-plus-longest-question limit with room for provider framing.
This is a byte bound, not a tokenizer estimate. Bounded text/history excerpts
and candidate metadata are model-only projections; exact URLs, DOM identity,
field values and approval arguments remain in the original execution snapshot.
Field previews sent to Jev are bounded to 500 characters; target and related-form
freshness retain full values inside the isolated world so later edits beyond that
preview cannot authorize stale fill/Enter input.
Hittable targets take priority over offscreen ones when space runs out; a
target's operations are admitted together, scrolling/exit choices remain, and
`candidatesTruncated` signals omissions. A goal that cannot fit fails before
the network call. Failed provider responses retain a bounded machine error
code (including `max_tokens_exceeded`) and request ID when present; arbitrary
response text is not echoed because it can contain page content or secrets.

The same run deadline covers observation, decisions, text generation and
approvals. Jev requests have an additional 20-second bound, text generation
30 seconds, input execution 5 seconds. An input deadline is reported with
`errorCode: action_timeout`, separately from the overall run deadline.
Target failures distinguish clipping, occlusion, replacement, focus and
coordinate changes instead of reporting all of them as a changed page.
Return statuses distinguish model
completion, new-tab handoff, blocked, missing input, unsupported capability,
exhausted budget, cancellation and error. A `needs_input_<ref>` Jev choice names
an observed fill field and returns `missing_field_value`; there is no generic
missing-input choice that also means unsupported. `unsupported_interaction`
hands capability selection to the caller. Invalid field-model output and
provider failures are errors, not requests for user data.
`verified` is always false: model completion and its goal probability are
signals for the caller to check against the returned page evidence. Traces
record proposals, actual execution and outcomes; usage is Jev token usage,
not a total bill including the text model. No live API accuracy or latency is
implied by the offline tests.

`evidence` remains the last observed view for compatibility and includes root
and region scroll positions even if the final text is empty. `reading` collects
distinct URL/text views throughout a run, including before a later error or
handoff. Entries retain the step, source URL/title and scroll positions; the
collection caps at 60 views and 48k text characters, with explicit `truncated`
and observation counts. Per-view truncation also marks the collection partial.
Only compact reading progress goes back to Jev, not accumulated text; this
prevents multi-step reading from growing the decision request beyond its bound.
Reaching a scroll-region bottom is not proof of complete site/document coverage.

`mode: read` selects a document region through Jev once, then repeats guarded
scroll/settle/observe operations in code. Jev is consulted again only after a
pre-input recovery requires region selection. Its candidate contract excludes
`done`, clicks and text entry; `read_complete` is a code-observed stable region
end, not model completion or proof of full document/media coverage. The current
position is the start, not an implicit rewind. Tasks needing semantic early
stopping or interaction use `act`. All modes retain per-action Ask approvals,
registration/URL/DOM freshness, cancellation, time and 1–60 step budgets.

Reading observations keep the selected node's identity and semantic attributes,
collect text within that region, and avoid rebuilding interactive candidates.
Navigation stops the reading task; region replacement/occlusion requires full
re-observation and bounded reselection. Explicit `aria-busy` suspends scrolling;
blank/image-only views and persistent media progress indicators do not mean
loading. Keep the 250ms settle interval until slower virtual rendering has
coverage evidence. At an observed bottom, wait and re-observe text, position and
height before reporting `read_complete`; appended content continues traversal.
Capture capacity stops traversal before further scrolling. `source` distinguishes
Jev selections from program steps; program steps have no model confidence.

`reading.truncated` describes capture limits, not host tool-output delivery.
Version 2 keeps results up to 12k serialized characters inline. Larger results
save a complete `trace.json` and ordered text parts under the scope's runtime
`page-runs/run-*` directory. Responses include `traceFile`, `stepCount`,
`executedSteps`, `reading.directory`, and `reading.parts` with relative
`fileName`/character/line counts. Read every directory/fileName in order before
summarizing the captured text. Parts preserve observations and overlap verbatim,
bounded to 5,000 characters and 500 lines without splitting surrogate pairs, so
the existing read tool can deliver each part completely. `inlineComplete: false`
is separate from capture truncation; neither proves the caller read every part.

Runtime filenames are generated by code; workspace traversal and output symlinks
are rejected. New directories/files use 0700/0600; writes are asynchronous.
No automatic pruning removes files referenced by historical runs. Write failures
return `reading_delivery_failed` with available inline evidence rather than
inventing file pointers. Per-phase `timings` distinguish observation, model,
approval, input, freshness and settle time; large-result `deliveryMs` measures
serialization/file delivery separately. Timings and Jev call counts do not imply
main-model cost or end-to-end summarization latency.

Regression coverage lives beside `page-run/` and in `input-guard.test.ts`;
existing page-control/CDP tests pin compatibility. Use the Canvas standard
checks, a real Electron page fixture, and a separately configured Jev call
when validating the complete live model path.

## Evidence

Primary regression suites live in:

- `src/main/app/__tests__/link-policy.test.ts`
- `src/main/app/__tests__/webview-shortcuts.test.ts`
- `src/main/webview/__tests__/registry.test.ts`
- `src/renderer/src/modules/canvas/components/node-bodies/IframeNodeBody/useWebviewRegistration.test.tsx`
- `src/renderer/src/modules/dock/internal/RightDock/__tests__/dock-store.test.ts`
- `src/renderer/src/modules/dock/internal/RightDock/__tests__/dock-browser-commands.test.ts`
- `src/renderer/src/modules/dock/internal/RightDock/__tests__/dock-link-opens.test.ts`
- `src/main/dock/__tests__/tab-actions.test.ts`
- `src/renderer/src/modules/dock/internal/RightDock/useDockAgentBridge.test.tsx`
- `src/renderer/src/modules/dock/internal/RightDock/__tests__/DockTabSwitcher.test.tsx`
- `src/renderer/src/modules/dock/internal/LinkDrawer/__tests__/address-bar.test.tsx`
- `src/renderer/src/modules/dock/internal/LinkDrawer/__tests__/find-in-page.test.tsx`

The real-app driver sends normal input to the host target. To exercise a
guest's `before-input-event` shortcut relay, attach CDP to the `type: webview`
target and dispatch input there.
