# Terminal surface sizing (xterm fit policy)

`src/renderer/src/modules/coding-agent/terminal.ts` is the public entry for the
shared sizing policy currently owned by the coding-agent module: agent nodes,
terminal nodes, and the workspace terminal dock. Read this file before
touching how any of those surfaces mount, resize, restore, or scroll a
terminal.

## Rule: never call `fitAddon.fit()` directly

NEVER call `fitAddon.fit()` directly. Go through `fitTerminalIfSane` or
`fitTerminalWithCanvasScale` instead (both exported from
`modules/coding-agent/terminal.ts`). Every real consumer already follows
this — there is no direct `fitAddon.fit(` call site anywhere else in `src/`.

## Why: FitAddon's column clamp turns into permanent scrollback damage

`FitAddon` floors `availableWidth / cellWidth` and clamps at a minimum of 2
columns. A container measured mid-layout — a node that has not been sized
yet, a hidden or freshly re-parented terminal, a `--canvas-scale` change
still in flight — therefore proposes a nonsense 3–5 column terminal instead
of rejecting the measurement.

For a plain shell that would just be briefly ugly. For a coding agent it is
permanent damage: a coding agent renders its OWN layout to the PTY width, so
applying that 3–5 column fit hard-wraps every line it prints at that moment
into a 4-character ribbon that no later re-fit can undo — xterm reflows only
its own soft wraps, not text a remote program already hard-wrapped — and the
scrollback persists it that way.

Refusing a nonsense fit costs nothing: the terminal simply keeps its
previous geometry, and the staged re-fits plus the `ResizeObserver` apply
the real geometry a frame or two later (see the ladder below).
`fitTerminalIfSane` is the guard that makes this refusal happen — it calls
`fit.proposeDimensions()` and will not apply a fit unless the proposed
`cols`/`rows` are finite and `cols` is at least `MIN_FITTABLE_TERMINAL_COLS`
(20).

## The mount/reattach fit ladder, and its scroll side effect

`scheduleTerminalFit(fitAddon, term, containerEl)` is the mount/reattach fit
ladder. Geometry settles over the next few frames — the first passes are
usually the ones `fitTerminalIfSane` rejects — so it re-tries at: now, +2
animation frames, +80ms, and +240ms.

Every pass in that ladder also calls `term.scrollToBottom()`, and this is
deliberate, not incidental: mount-time writes (a restored scrollback, or a
live agent's first output frames) land while the terminal is still sizing,
and without the scroll they leave a restored session parked mid-history.

The debounced `ResizeObserver`-driven re-fit (`createDebouncedTerminalRefit`,
trailing-debounce window `TERMINAL_REFIT_DEBOUNCE_MS` = 120ms) applies the
real geometry on later container-size changes — a canvas-scale animation in
flight, or a user drag-resizing a node. That path must NOT scroll: it fires
while the user is actively reading history, and forcing the viewport to the
bottom there would yank it out from under them. This is the one behavioral
difference between the two re-fit paths — do not unify them into a single
"always scroll" or "never scroll" helper.

## Contract (exports of `modules/coding-agent/terminal.ts`)

- `MIN_FITTABLE_TERMINAL_COLS` (20) — floor below which a proposed fit is
  rejected outright.
- `fitTerminalIfSane(term, fit)` — the sanity-checked fit primitive; returns
  whether the terminal now matches its container.
- `fitTerminalWithCanvasScale(term, fit, containerEl)` — syncs the xterm
  font size to the cascading `--canvas-scale` CSS variable first, then calls
  `fitTerminalIfSane`.
- `fitAndRefreshTerminal(fitAddon, term, containerEl?)` — one fit pass for a
  canvas-hosted terminal: sync font size (if a container is given), sane-fit,
  then `term.refresh(...)` the visible rows.
- `scheduleTerminalFit(fitAddon, term, containerEl?)` — the mount/reattach
  ladder described above; every pass scrolls to bottom.
- `createDebouncedTerminalRefit(refit)` — trailing-debounce wrapper for
  `ResizeObserver`-driven refits (`TERMINAL_REFIT_DEBOUNCE_MS` = 120ms); does
  not scroll.
- `readCanvasScale(el)` / `syncTerminalFontSizeToCanvas(term, containerEl)` —
  read the `--canvas-scale` custom property `CanvasSurface` injects onto
  `.canvas-transform`, and keep xterm's font size in lock-step with it.

## Consumers (every xterm in the app)

- Agent nodes: `src/renderer/src/modules/coding-agent/components/AgentNodeBody/useAgentNodeController.ts`.
- Terminal nodes: `src/renderer/src/modules/canvas/components/node-bodies/TerminalNodeBody/index.tsx`.
- The workspace terminal dock: `src/renderer/src/components/dock/WorkspaceTerminalDock/index.tsx`.

All three call into the fit primitives above rather than the raw
`FitAddon`.

## Related but distinct: terminal keyboard ownership

`terminal.ts` also owns `decideTerminalKey`, the keystroke-arbitration
policy for a focused terminal (Cmd-chords released to the app, Ctrl-chords
kept by the shell, double-Escape release-to-canvas). That is a separate
concern from the sizing policy on this page — it is documented in
`harness/knowledge/keyboard-shortcuts.md` ("Terminal key policy" section),
which is also the file to read before touching terminal focus/keyboard
behavior.

## Evidence

- `src/renderer/src/modules/coding-agent/components/AgentNodeBody/utils/terminalFit.test.ts` —
  the bound regression suite for this sizing policy.
