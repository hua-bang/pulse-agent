# Keyboard shortcuts

The workbench's keyboard shortcuts are a cross-layer contract, not a single
file: a binding declared in the renderer registry must be implemented by
exactly one owning handler table, must not collide with an Electron menu
accelerator (which wins before the renderer ever sees the key), must survive
focus moving into an embedded `<webview>` guest or a focused terminal, and
must be labeled consistently in the help overlay and the command palette.
Read this file before adding, renaming, or removing a keyboard shortcut;
before touching `src/main/app/menu.ts`'s roles or accelerators; before
touching the webview shortcut-forwarding chain; or before changing terminal
key handling.

## Registry: the runtime SSOT

`src/renderer/src/shortcuts/` is the runtime source of truth for every
keyboard binding in the workbench:

- `definitions.ts` — the binding table. Exports the `SHORTCUTS` const
  (`satisfies Record<string, ShortcutDefinition>`), one entry per shortcut id
  (e.g. `'canvas.commandPalette'`, `'canvas.zoomIn'`, `'app.toggleSidebar'`).
  Each definition names an `owner` and a list of `bindings`. Also exports the
  derived types `ShortcutId` (`keyof typeof SHORTCUTS`) and
  `ShortcutIdFor<O extends ShortcutOwner>` — the mapped type that narrows
  `ShortcutId` down to only the ids owned by one layer. This mapped type is
  the actual mechanism behind the type-error guarantee described in the next
  section.
- `types.ts` — shape declarations: `ShortcutOwner` (which layer owns the
  handler for a shortcut — `'canvas'` for `useCanvasKeyboard`, `'app'` for
  `useAppShortcuts` in `App.tsx`, and `'document'` for the one binding
  handled by a native document-level event instead of the keydown
  dispatcher: `canvas.paste` is declared with `owner: 'document'`, because
  letting the browser's native `paste` event arbitrate — rather than a
  keydown handler — is what lets the system clipboard beat a stale canvas
  clipboard); `KeyBinding` (`key`, `mod`, `ctrl`, `alt`, `shift`, `display`,
  `hidden`); `ShortcutDefinition` (`owner`, `bindings`, `editable`,
  `requiresSelection`); `EditablePolicy` (`'block' | 'allow'`); `KeyEventLike`.
- `registry.ts` — matching + platform-correct labels: `formatBinding` (one
  binding's display string — `⌘K` on macOS vs `Ctrl+K` elsewhere, via
  `formatShortcut` in `src/renderer/src/utils/keyboardShortcut.ts`),
  `formatShortcutId` (a definition's first visible binding, used for palette
  shortcut hints), `formatAllBindings` (one label per visible binding — the
  help overlay renders each as its own chip group, because joining them into
  a single string made it split on `+` and chip `Ctrl+Tab / Ctrl+Shift+Tab`
  as four separate pieces instead of two combos), and `matchesBinding` /
  `matchShortcut` (the exact-modifier matcher — see below).

Behavior is deliberately NOT declared in the registry — it lives in the
owner's handler table, described next. The registry only knows chords,
labels, and ownership.

## Typed handler tables make a doc-only shortcut a type error

Behavior lives in the owner's handler table:

- `src/renderer/src/hooks/useCanvasKeyboard.ts` (owner `canvas`), gated on
  the visible unlocked canvas.
- `src/renderer/src/hooks/useAppShortcuts.ts` (owner `app`), works on every
  route — split from the canvas layer on purpose, because the canvas layer
  is gated on the visible unlocked canvas while these must keep working on
  the chat page and the node pages.

Both are typed `Record<ShortcutIdFor<'…'>, Handler>` — concretely
`Record<CanvasShortcutId, (event: KeyboardEvent, binding: KeyBinding) =>
void>` in `useCanvasKeyboard`, and `Record<AppShortcutId, (event:
KeyboardEvent) => void>` in `useAppShortcuts`. Because `ShortcutIdFor<O>` is
a mapped type over every id in `definitions.ts`, **a
documented-but-unimplemented shortcut is a TYPE ERROR**: a definition declared with
`owner: 'canvas'` that has no matching key in the `useCanvasKeyboard`
handler object fails `tsc`, and deleting a handler while its definition (and
therefore its help-overlay row) still exists fails to compile the same way.
That is what previously let `Cmd+Shift+A` ship in the help overlay and the
command palette with no handler while silently running select-all.

This is the exact incident recorded at repo root (`AGENTS.md` §6,
"Documented-but-unimplemented shortcuts"), in full:

> Three surfaces hand-wrote the same binding (behavior, help overlay,
> command palette), so `Cmd+Shift+A` shipped advertised-with-no-handler and —
> because the matcher ignored unlisted modifiers — actually ran select-all.
> Guard: `apps/canvas-workspace/src/renderer/src/shortcuts/` is the single
> declaration site and the owning hooks type their handler tables as
> `Record<ShortcutIdFor<owner>, Handler>`, making the gap a TYPE ERROR;
> runtime halves are pinned by the `keyboard-shortcuts` rule in that
> workspace's `harness/validate/validation.yaml`. Rule: a UI surface must
> never hardcode a chord or its label — derive both from the registry.

Never hand-write a chord condition (e.g. a raw `if (event.metaKey &&
event.key === 'd')`) or a hardcoded label (e.g. a literal `'Cmd+D'` string)
anywhere in the app again — both must come from the registry
(`matchShortcut` / `formatBinding` / `formatShortcutId` / `formatAllBindings`).

## Derived labels: help overlay and palette, behind a lazy boundary

Two surfaces render shortcut labels, and both derive them from the registry
instead of hardcoding strings:

- The lazy `?` overlay, `src/renderer/src/components/shell/AppShellProvider/ShortcutsDialog.tsx`,
  exhaustively maps runtime shortcut IDs to display metadata — `SHORTCUT_HELP`
  is itself declared `satisfies Record<ShortcutId, { section, descriptionKey }>`,
  so it cannot go stale against the registry either — and derives its combo
  labels from the registry via `formatAllBindings`. The same dialog also
  renders `GESTURE_HELP`, help-only mouse gestures with no keyboard binding
  at all (right-click/double-click to open the create menu, scroll to pan,
  Space+Drag to pan, Ctrl/Cmd+Scroll to zoom, drag-on-blank-canvas for a
  marquee select, click/Shift-click/Ctrl-Cmd-click for selection, Shift+drag
  to extend a marquee, Ctrl/Cmd while dragging to disable snap), interleaved
  into the same sectioned layout (`SECTION_ORDER`: `canvas`, `view`,
  `selection`, `edit`, `panels`). `ShortcutsDialog` itself is only mounted
  through `React.lazy(() => import('./ShortcutsDialog'))` in
  `src/renderer/src/components/shell/AppShellProvider/index.tsx` — it is not
  loaded until the user opens the `?` overlay.
- Palette hints, `src/renderer/src/components/canvas/Canvas/hooks/useCanvasPaletteCommands.ts`,
  also derive from the registry: every Cmd+K palette command that has a
  keyboard equivalent sets its `shortcut` field via
  `formatShortcutId('canvas.…')` / `formatShortcutId('app.…')` rather than a
  literal string.

Keep help-only descriptions and gestures behind that lazy boundary (i.e., as
entries in `ShortcutsDialog.tsx`'s `SHORTCUT_HELP` / `GESTURE_HELP`) instead
of adding them to the startup matcher (`definitions.ts` and the handler
tables) — a row that exists only to be documented does not need a
`ShortcutDefinition` or a handler.

## Terminal-scoped shortcuts: a third owner, and why claiming is explicit

`owner: 'terminal'` (`shortcuts/terminalShortcuts.ts`) is dispatched from
xterm's `attachCustomKeyEventHandler` instead of a window listener, because a
focused terminal is a SCOPE, not a route: a chord it owns must beat the global
layers while it has focus and mean nothing anywhere else. `RightDock`'s
`DOCK_FOCUS_SCOPED_COMMANDS` is the same idea one surface over. That scoping
is what lets `terminal.mentionPicker` deliberately share Cmd/Ctrl+2 with
`app.switchWorkspace` — the registry's own "no colliding chords" test is
per-owner for exactly this reason.

**Returning `false` from an xterm custom key handler stops XTERM ONLY.** The
DOM event keeps bubbling to the window listeners `useCanvasKeyboard` and
`useAppShortcuts` install, so a surface that merely returns false has not
claimed anything. Four surfaces (`AgentNodeBody/useAgentNodeController.ts`
twice, `TerminalNodeBody`, `WorkspaceTerminalDock`) each hand-wrote
`if (key === '2' && (ctrlKey || metaKey))` and returned false, and the result
was that Cmd+2 in a terminal or coding-agent node opened the node-mention
picker AND switched workspace out from under the user. Both dispatchers skip
an event whose `defaultPrevented` is set, so `preventDefault` — not the
`false` return — is what resolves a collision. `handleTerminalShortcut` does
it for registry-owned chords; `claimTerminalKey` is the same escape hatch for
a chord a terminal borrows from another owner without owning it (the dock
terminal's font-size keys, which otherwise drove `canvas.zoom*` at the same
time).

Capture-phase window/document listeners (`useEscapeClose`,
`useMenuKeyboardNav`, the marquee/shape hooks) have already run by the time a
guest textarea sees the key, so the `stopPropagation` in `claimTerminalKey`
cannot starve them — it only stops the bubble-phase dispatchers, which is the
collision source.

Handlers are an exhaustive `Record<TerminalShortcutId, () => void>`, the same
type-error guarantee the other two owners give.

## Matching semantics: exact on modifiers

Matching is EXACT on modifiers. `matchesBinding` in `registry.ts` requires
every unlisted modifier to be up, not just the listed ones to be down — a
definition without `shift` does not fire when Shift is held. This exactness
is what stops `Cmd+Shift+A` from falling into the `Cmd+A` (`canvas.selectAll`)
branch: the earlier hand-written matcher checked only the modifiers a
condition happened to mention, so an unlisted Shift fell through silently.

## macOS-eaten chords

macOS eats `Cmd+H` and `Cmd+Tab` before the renderer ever sees them
(`Cmd+H` is "hide application", `Cmd+Tab` is the app switcher) — use literal
`ctrl: true` for those bindings, not `mod: true`. In `definitions.ts` this is
why `canvas.commandPaletteAlt` (the macOS-safe alternate to
`canvas.commandPalette`'s `Cmd/Ctrl+K`) binds `{ key: 'h', ctrl: true }`, and
`canvas.cycleNodes` binds `{ key: 'Tab', ctrl: true }` /
`{ key: 'Tab', ctrl: true, shift: true }` rather than `mod: true` — `Cmd+Tab`
is the macOS app switcher and never arrives at the renderer. The registry
test suite (`registry.test.ts`, "keeps macOS-reserved chords off the mod
modifier") pins this by asserting no binding for key `h` or `Tab` ever sets
`mod: true`.

## `editable: 'allow'` semantics

`editable: 'allow'` is what keeps a chord alive inside a text field or
terminal — reserved for chords that have no text-editing meaning, so
stealing the keystroke from a focused input never costs the user a character
they meant to type. Both dispatchers (`useCanvasKeyboard`'s `keydown`
listener and `useAppShortcuts`'s) check `match.definition.editable !==
'allow'` before applying their "is focus on an editable element" guard, so
`'allow'` shortcuts are the only ones that still reach their handler while an
`<input>`, `<textarea>`, or `contentEditable` element has focus. Every other
definition defaults to `'block'` (the `EditablePolicy` default) and is
dropped while an editable element is focused. `canvas.find` is a case where
the handler adds its own narrower guard on top of `editable: 'allow'`: it
explicitly excludes focus inside `.note-card`, iframe-node chrome, and Link
Drawer browser/find surfaces, because those areas own their own find flow and
must not have canvas-level search steal focus from note editing, embedded page
controls, or browser find-in-page.

## Menu-accelerator precedence

Menu accelerators in `src/main/app/menu.ts` outrank ALL of the
renderer-side matching described above: Electron consumes a `role` menu
item's accelerator in the MAIN process before the keystroke ever reaches the
renderer, so a default role claiming a chord makes that chord permanently
unavailable to the registry no matter what `definitions.ts` says. The
Undo/Redo and zoom roles are deliberately gone from the application menu so
the canvas can own `Cmd+Z` and `Cmd+0/±` (`canvas.undo` /
`canvas.redo`/`canvas.redoAlt`, and `canvas.zoomReset` / `canvas.zoomIn` /
`canvas.zoomOut` in `shortcuts/registry.ts`'s definitions).

This is the exact incident recorded at repo root (`AGENTS.md` §6, "Menu
accelerators silently ate renderer shortcuts"), in full:

> Electron `role` menu items consume a keystroke in MAIN before any renderer
> listener sees it. The default `viewMenu` roles took `Cmd+0`/`Cmd+±` for
> webFrame zoom, so the canvas could not own zoom at all, and the same class
> had already forced Undo/Redo out of the Edit menu. Guard:
> `apps/canvas-workspace/src/main/app/menu.ts` builds an explicit View menu
> without the zoom roles and documents why. Rule: before adding any renderer
> shortcut, check `menu.ts` for a role that claims the chord — and never add
> a `role` whose accelerator collides with a registry binding.

`menu.ts`'s own header comment documents the same two removals by name: the
Edit menu's Undo/Redo (`CmdOrCtrl+Z` / `Shift+CmdOrCtrl+Z`) used to swallow
the canvas's own history — text inputs still get native undo from Chromium
once the key reaches the page, and the note editor (TipTap) ships its own
history keymap, so removing the role does not remove undo from text editing,
only from the canvas-eating accelerator; the View menu's `resetZoom` /
`zoomIn` / `zoomOut` (`CmdOrCtrl+0` and `+`/`-`) used to zoom the whole UI via
`webFrame`, which on a canvas app reads as a bug because the user means "zoom
the canvas" — those keys now reach the renderer and drive the canvas
transform instead. Today's `View` submenu keeps only `toggleDevTools` and
`togglefullscreen` (plus `reload`/`forceReload`, gated behind
`!app.isPackaged` so a stray `Cmd+R` in a packaged build cannot tear down
every live terminal PTY and webview guest) — no resetZoom/zoomIn/zoomOut
role remains. The `Edit` submenu keeps only `cut`/`copy`/`paste`
(`pasteAndMatchStyle` on macOS)/`delete`/`selectAll` — no undo/redo role
remains. Any future renderer shortcut must check `menu.ts` for a role that
already claims its chord before relying on that chord reaching the renderer.

## Webview forwarding whitelist chain

Focus black holes are closed at the edges. Once focus moves into an embedded
`<webview>` guest, host `keydown` listeners stop seeing anything at all — a
guest is a separate Electron renderer process — so without forwarding, the
command palette, workspace switching, canvas zoom, and even Escape would all
go dead, with the mouse as the only way back out. Guests forward a narrow
whitelist through three files, in this order:

1. `src/shared/webview-shortcuts.ts` — declares `WEBVIEW_FORWARDED_CHORDS`,
   the whitelist itself, grouped exactly as in source: command palette
   (`{ key: 'k', mod: true }`) plus its macOS-safe alternate
   (`{ key: 'h', ctrl: true }`); node cycling (`{ key: 'Tab', ctrl: true }`,
   `{ key: 'Tab', ctrl: true, shift: true }`); canvas zoom
   (`{ key: '0', mod: true }`, `{ key: '=', mod: true }`,
   `{ key: '-', mod: true }`); panels (`{ key: 'a', mod: true, shift: true }`,
   `{ key: 'e', mod: true, shift: true }`, `{ key: 'l', mod: true, shift: true }`,
   `{ key: '\\', mod: true }`); workspace switching (`{ key: '1'..'9', mod: true }`,
   all nine); and bare `Escape` — "the way back out of a guest that has
   swallowed focus." It also exports `isForwardedShortcut`, the matcher main
   uses to decide whether to intercept a guest keystroke at all. The list is
   deliberately narrow: anything a web page might legitimately want — Cmd+F
   find-in-page, Cmd+C/V, arrow keys, Delete — stays with the guest. It lives
   in `shared/` because main cannot import the renderer's shortcut registry
   directly; `registry.test.ts` ("forwards only chords the registry actually
   binds") asserts every chord in `WEBVIEW_FORWARDED_CHORDS` still resolves
   through `matchShortcut` for either the `canvas` or `app` owner, so the
   whitelist and the registry cannot drift apart.

Dock-browser Find adds a browser-default layer after this generic rule. Main
still lets Cmd/Ctrl+F reach the guest, then `src/preload/webview-find.ts` waits
until the complete cross-world keydown dispatch finishes in the next task. A
microtask is too early because Electron may flush the isolated preload world
before continuing page-main-world listeners. A default-prevented or
propagation-stopped DOM event belongs entirely to the site; an event with
neither signal sends `pulse:dock-find-fallback` to the active `LinkTabView`,
which opens Pulse Canvas's floating find bar. Never move Find back into an
unconditional `before-input-event` interception, or reduce this to only one
DOM cancellation signal: either regression makes document apps such as Feishu
open alongside the host find bar.
2. `src/main/webview/shortcut-forwarding.ts` — `attachShortcutForwarding`
   hooks each guest's `before-input-event` exactly once, tracked in a
   `WeakSet<WebContents>` (`hooked`) so a destroyed guest drops out with no
   bookkeeping and re-registering the same node id never stacks duplicate
   listeners. For a whitelisted chord it calls `event.preventDefault()` on
   the guest FIRST, before forwarding, so the page cannot also act on the
   same key on top of the host action (e.g. a page's own Cmd+0 zoom reset, or
   a web app treating Escape as "close my modal"); it then sends the chord to
   the host over the `iframe:shortcut` IPC channel
   (`WEBVIEW_SHORTCUT_CHANNEL`).
3. `src/renderer/src/hooks/useWebviewShortcutBridge.ts` — receives that IPC
   payload and re-dispatches it as an ordinary `window` `keydown`
   (`new KeyboardEvent('keydown', { …, bubbles: true, cancelable: true })`)
   rather than calling a handler directly. Re-dispatching (instead of calling
   handlers directly) is deliberate: the canvas and app layers own their own
   guards (locked canvas, open overlay, focused input), and routing through a
   real event keeps exactly one set of rules instead of a second,
   webview-specific code path.

## Terminal key policy

A focused terminal keeps Ctrl-chords but yields Cmd-chords and releases
focus on double-Escape. The arbitration function is `decideTerminalKey` in
`src/renderer/src/modules/coding-agent/components/AgentNodeBody/utils/terminal.ts`. A focused
terminal is otherwise its own keyboard black hole: xterm's helper element is
a `<textarea>`, so the canvas dispatcher's editable guard silently drops
every shortcut typed while it has focus, with no route back out. The split
is asymmetric on purpose: Cmd-chords are safe to steal because a TTY never
sees Cmd, but Ctrl-chords are the terminal's own language (`Ctrl+C`,
`Ctrl+K` kill-line, `Ctrl+H` backspace, `Ctrl+\` SIGQUIT) and stay with the
terminal exactly as they do in a real terminal emulator — which leaves
Windows/Linux users needing a modifier-free way out. `decideTerminalKey`
takes the event, the timestamp of the last Escape (`lastEscapeAt`), and the
current time (`now`), and returns one of three `TerminalKeyDecision`
values:

- `'terminal'` — let xterm handle it (the default, and the fallback for
  every non-Escape, non-Cmd key).
- `'app'` — don't let xterm consume it; the app's shortcut layer handles
  it. Chosen whenever `event.metaKey && !event.ctrlKey`.
- `'release-focus'` — release focus back to the canvas. Chosen when
  `event.key === 'Escape'` (with no Ctrl/Cmd/Alt held) and the previous
  Escape landed within `TERMINAL_ESCAPE_HATCH_MS` (400ms) of this one — the
  double-Escape. A single Escape still belongs to the shell (vim depends on
  it); two in quick succession blur the terminal and hand focus back to the
  canvas.

`decideTerminalKey` is PURE — the two stateful halves live in
`AgentNodeBody/utils/terminalFocus.ts`, so no surface hand-rolls them:

- `createTerminalKeyArbiter` owns the double-Escape timestamp and returns
  exactly what an xterm custom key handler must return. Its "no previous
  Escape" sentinel is `-Infinity`, NOT 0: the rule asks whether
  `now - lastEscapeAt` is inside the hatch window, so a 0 sentinel makes a
  first Escape pressed while `performance.now()` is still under 400ms read as
  the second half of a pair and blur on its own. The same sentinel is used to
  reset after a release, so the next Escape starts a fresh pair.
- `releaseTerminalFocus` owns the blur sequence. All three steps matter:
  xterm's own `blur()` clears its internal focus state, the container blur
  covers a surface whose wrapper took focus, and the `activeElement` blur is
  the backstop for the helper textarea, which is neither of those elements.

All four xterm handlers route through the arbiter. Until 2026-08 only
`TerminalNodeBody` did: the coding-agent node and the workspace terminal dock
had hand-rolled handlers with no hatch at all, so focus in either one could
only be escaped with the mouse. NOTE the cost in a coding-agent node: the
second Escape is not forwarded to the PTY, so a CLI that binds double-Escape
itself (Claude Code's jump-to-previous-message) cannot see it there.

## Bound checks

Bound checks: the `keyboard-shortcuts` rule in `harness/validate/validation.yaml`.
That rule's own comment states the split of responsibility explicitly:
keyboard shortcuts are a cross-layer contract — bindings in
`shortcuts/registry`, the canvas + app handler tables, the lazy help overlay
and palette labels derived from them, the webview forwarding whitelist in
`shared/`, and the terminal key arbitration. Typecheck already catches a
documented-but-unimplemented shortcut (the handler tables are exhaustive by
type); the suites bound by this rule cover the runtime halves instead —
exact-modifier matching, auto-repeat, Escape ownership, and clipboard
recency.

The rule's `paths` cover: `src/renderer/src/shortcuts/**`,
`src/renderer/src/hooks/useCanvasKeyboard.ts`,
`src/renderer/src/hooks/useAppShortcuts.ts`,
`src/renderer/src/hooks/useWebviewShortcutBridge.ts`,
`src/renderer/src/utils/keyboardShortcut.ts`,
`src/renderer/src/components/shell/AppShellProvider/ShortcutsDialog.tsx`,
`src/shared/webview-shortcuts.ts`,
`src/main/webview/shortcut-forwarding.ts`, `src/main/app/menu.ts`,
`src/renderer/src/modules/coding-agent/components/AgentNodeBody/utils/terminal.ts`,
`src/renderer/src/modules/coding-agent/components/AgentNodeBody/utils/terminalFocus.ts`, and the four
xterm surfaces that dispatch terminal-owned shortcuts
(`AgentNodeBody/useAgentNodeController.ts`, `TerminalNodeBody/index.tsx`,
`WorkspaceTerminalDock/index.tsx`, `NodeMentionPicker/index.tsx`).

Its `quick` step and its `required` step both run:

```
pnpm --filter canvas-workspace exec vitest run src/renderer/src/shortcuts src/renderer/src/hooks/useCanvasKeyboard.test.ts src/renderer/src/hooks/useAppShortcuts.test.ts src/main/webview/__tests__/shortcut-forwarding.test.ts src/renderer/src/modules/coding-agent/components/AgentNodeBody/utils/terminalKeys.test.ts
```

`required` additionally runs `pnpm --filter canvas-workspace typecheck`
first.

## Evidence

Primary regression suites live in:

- `src/renderer/src/shortcuts/registry.test.ts`
- `src/renderer/src/shortcuts/terminalShortcuts.test.ts` — pins the Cmd+2
  collision end to end against the REAL `useAppShortcuts`, including the
  control case that fails if the chord ever stops being shared
- `src/renderer/src/hooks/useCanvasKeyboard.test.ts`
- `src/renderer/src/hooks/useAppShortcuts.test.ts`
- `src/main/webview/__tests__/shortcut-forwarding.test.ts`
- `src/renderer/src/modules/coding-agent/components/AgentNodeBody/utils/terminalKeys.test.ts` — the
  pure decision rule
- `src/renderer/src/modules/coding-agent/components/AgentNodeBody/utils/terminalFocus.test.ts` — the
  stateful hatch: double-Escape, the window boundary, the post-release reset,
  the time-zero sentinel, and the blur sequence
