# Dock browser behavior

The RightDock link tab is an embedded browser surface, not just another React
preview. Its page runs in a separate Electron `<webview>` WebContents, so host
DOM focus, keyboard events, navigation policy, and guest lifetime all require
explicit contracts.

## Surface and navigation policy

Every mounted guest registers a `WebviewRegistration` from
`src/shared/webview-registration.ts` with all of:

- `surfaceKind`: `dock-browser` or `canvas-node`;
- `workspaceId` — the renderer mount route for the guest, not Link Tab
  ownership;
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

## Link-open identity and renderer routing

`link:open` carries both the legacy `sourceWebContentsId` and the full source
registration. The renderer accepts it only when the full identity exactly
matches a currently mounted guest in `IframeNodeBody/webview-identities.ts`.
It must not guess the active workspace or resolve a tab from a bare id.

The source registration is used to validate the event and choose browser-style
focus behavior, but Link Tabs are application-global. The source workspace is
only a renderer mount/focus hint, even if another workspace became active
before the event arrived:

- active source workspace: open normally, beside its global dock opener when
  one exists;
- inactive source workspace: add to the global tab strip in the background so
  it cannot steal focus from the visible workspace;
- switching workspaces: keep the same Link Tab id and WebView pane, changing
  only the renderer mount route recorded in its registration.

Chromium `background-tab` disposition never steals focus. Foreground opens
activate the resulting tab and focus that tab, while source-restoring menu
actions focus the opener only when they do not navigate away from it.

## Guest lifetime

Restored/cold link tabs mount lazily: only a visible dock page is mounted for
the first time. Collapsing the dock must not cold-mount hidden pages. Once a
guest has mounted it remains resident through tab switches, dock collapse,
and Workspace switches because its Link Tab is global. L3 Memory Saver may later discard an
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

`DockPanes` renders global Link Tabs from one stable list keyed by the
application-unique tab id. Do not split them into workspace-owned sibling
lists or move a `<webview>` within its parent; either operation can cause
Chromium to recreate the guest. Hidden guest navigations write through to the
global tab record, so the persisted URL never drifts from the live page.

`DockPanes` gates `LinkTabView`'s `mountWebview` prop on that same visibility
check — the concrete mechanism behind first-mount laziness, so a restored
dock does not spawn one guest process per tab on the cold-start path. Agent
tools that activate a tab before reading it must poll for registration via
`main/webview/ensure-operable.ts` rather than assume the guest already exists.

## Focus and keyboard ownership

`RightDock/dock-browser-commands.ts` owns mount-workspace-and-tab-qualified
focus intents. A focus request persists until the exact guest exists; it is
canceled when a different target becomes active or the dock is hidden. The
workspace qualifier identifies the current renderer mount route, not Link Tab
ownership. This is needed for blank-tab address commits and WebView
registration handoff, where a short-lived timeout races normal mounting.

Address, reload, and find commands are also qualified by workspace and tab.
The active `LinkTabView` ignores commands for another guest. Find keeps a
monotonic request id, ignores stale results, and replays the current query when
its guest is replaced.

Browser chords are shared in `src/shared/dock-shortcuts.ts`. Guest-focused
chords are relayed by main; dock-chrome chords are handled by
`RightDock/useDockKeyboard.ts`. From dock chrome, Escape collapses an active
web tab without destroying its browsing state, closes a reconstructible
content/terminal tab, and leaves the pinned chat alone. Escape inside a web
page stays page-owned so sites can close their own dialogs or exit modes.
Dock-owned portals count as dock focus for scoped commands such as Find.

## Page-element selection bridge

Page-element selection in a dock browser tab must reuse the shared iframe
DOM picker/selection context, then route the result through Workbench's
active-workspace chat bridge. That bridge must queue selections until the
target composer registers — opening chat and retrying on the next animation
frame is not a reliable mount barrier.

## Tabs and discoverability

`RightDock/dock-tab-items.ts` is the single visible-tab projection used by the
strip, keyboard cycling, and the All Tabs menu. Hidden terminal sessions are
excluded consistently. Overflow is discoverable through the accessible All
Tabs menu, and the pinned Pulse AI tab remains reachable at the start of the
strip rather than scrolling away with page tabs.

The strip and All Tabs menu share one fixed 16px icon slot and the same Pulse,
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

Closed web tabs enter one bounded, application-global reopen stack. Reopen must
allocate a fresh id if the original id already exists; duplicate React keys or
guest identities are never permitted.

Dock expansion is persisted with the application-global Link Tab session.
Switching workspaces therefore does not replace the visible Link Tab strip or
its expanded/collapsed state.

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

- `tab-store.ts` keeps two renderer mirrors: a global Link Tab projection for
  Global Agent calls and a workspace projection for resource tabs.
- `tab-actions.ts` sends the main→renderer workspace-scoped
  `dock:activate-tab` push behind resource activation and page_* targeting;
  global Link Tab activation first resolves the tab's current renderer mount
  workspace from the global mirror. The app-level `dock:open-tab` push powers
  `canvas_open_tab`, and the app-level `dock:open-artifact` push is used by the
  scheduled memory report — artifact `workspaceId` is a storage scope and may
  be the `__global_chat__` sentinel. Activation does not navigate away from
  the current host route (notably `#/chat`); the renderer acknowledges only
  after the requested tab is observably active.
- `history-store.ts` holds web-tab browsing history behind
  `canvas_search_history`.

`RightDock/tabRefs.ts` is the renderer-side tab-discovery SSOT: it covers
link, artifact, node-detail, canvas-preview, and terminal tabs plus
active/visible/split state. Terminal commands use `canvas_execute_terminal_tab`.

## Evidence

Primary regression suites live in:

- `src/main/app/__tests__/link-policy.test.ts`
- `src/main/app/__tests__/webview-shortcuts.test.ts`
- `src/main/webview/__tests__/registry.test.ts`
- `src/renderer/src/components/node-bodies/IframeNodeBody/useWebviewRegistration.test.tsx`
- `src/renderer/src/components/dock/RightDock/__tests__/dock-store.test.ts`
- `src/renderer/src/components/dock/RightDock/__tests__/dock-browser-commands.test.ts`
- `src/renderer/src/components/dock/RightDock/__tests__/dock-link-opens.test.ts`
- `src/main/dock/__tests__/tab-actions.test.ts`
- `src/renderer/src/components/dock/RightDock/useDockAgentBridge.test.tsx`
- `src/renderer/src/components/dock/RightDock/__tests__/DockTabSwitcher.test.tsx`
- `src/renderer/src/components/dock/LinkDrawer/__tests__/address-bar.test.tsx`
- `src/renderer/src/components/dock/LinkDrawer/__tests__/find-in-page.test.tsx`

The real-app driver sends normal input to the host target. To exercise a
guest's `before-input-event` shortcut relay, attach CDP to the `type: webview`
target and dispatch input there.
