# Bounding the live region

Everything rendered BELOW Ink `<Static>` shares one screen with the composer, so
every such region must be bounded by terminal size. An unbounded `.map()` there
pushes the composer off screen. Check this when adding any live region.

## Why it is a hard bound, not a nicety

Ink does not merely scroll an over-tall frame. `shouldClearTerminalForFrame`
(ink 7 `build/ink.js`) makes a frame taller than the viewport write
`clearTerminal + fullStaticOutput + output` — a full-screen wipe plus a replay
of the ENTIRE static transcript — and, because the rule also fires on
`wasOverflowing`, it keeps doing that on every following frame until the output
shrinks back under the viewport. At the streaming emit rate (33ms, see
`InkUiBridge.textThrottleMs`) that reads as the terminal flickering and jumping.

The streaming answer (`liveText`) was the region that hit this: it grew with the
model's output until it outgrew the screen. It now takes only the rows the
fixed-size regions leave over — `windowLiveTextLines()` in `ink-app.tsx` —
and the full answer still reaches scrollback when the run finalizes it into
`<Static>`. `src/ink/ink-app.render.test.tsx` renders the real component into a
mock TTY and asserts the frame height stays under the viewport (it measured
207 rows on a 24-row terminal before the bound existed). A snapshot cannot
express everything on that screen — the draft is the app's own state — so that
file also mounts with a paused-mode Readable stdin and types the draft in as
real bytes, the same way `ink-app.screen.test.tsx` drives the composer.

## Height is not the only thing that reads as instability

Two other effects get reported as "the terminal jumps", and they have different
causes and different fixes. Measure before treating either as a bound problem.

**Repaint churn.** Ink's default writer erases the whole live block and
repaints it on every frame — over a streaming answer that measured ~2x the
lines and bytes of the incremental writer, and at 30fps the status line and
bordered composer visibly shimmer. `ink-launcher.tsx` therefore renders with
`incrementalRendering: true`, which rewrites only the lines that changed.

**Composer drift.** The composer sits at the end of the output, so it moves up
the screen whenever the live region shrinks without matching `<Static>` output,
leaving dead rows below it. Ink already compensates the normal path: on a frame
with static output it erases the live block, writes the static rows into that
same space, then repaints the (shorter) block, so finalizing a streamed segment
into the transcript is geometry-neutral. Measured over a bridge-driven run, the
composer's total upward movement is 2 rows — it does not bounce.

Reserving a high-water height and padding the difference looks like the fix and
is not: it pins the composer mid-run, but it voids most of the screen (the
transcript gets squeezed into whatever rows the padding leaves) and turns the
release at run end into a single jump far larger than the drift it removed.
Measured: 2 rows of drift without the reservation, 13 with it.
`ink-app.screen.test.tsx` emulates a terminal and pins this.

## The two axes are coupled

Rows and columns are not independent budgets. Ink's default `wrap='wrap'`
reflows long text onto extra rows, so a window computed as one row per item is
silently wrong the moment an item is wider than the terminal. There are exactly
two correct resolutions, and every region must pick one:

1. **Truncate on columns**, so each item really is one physical row — what the
   tool labels, picker items and suggestion rows do.
2. **Charge each item its wrapped height** via `wrappedRowCount()` — what
   `liveText` does, because truncating streamed prose mid-sentence would be
   worse than showing fewer lines of it.

Greedy word wrap can need MORE rows than `ceil(width / columns)`
(`'aaaaaa bbbbbb cccccc'` is three rows at 10 columns, not two), so option 2
must simulate the wrap rather than divide. Undercounting is what puts the frame
over the viewport.

There is a third resolution for a region that must show whatever it holds:
**wrap it yourself and window the physical rows**. `wrapToRows()` (text-width)
is that wrap, and `wrappedRowCount()` is now just its length, so the counter and
the renderer cannot drift. The composer does this — the draft is rendered
pre-wrapped, one `<Text>` per row, each fitting the content width — because a
draft is a single logical line however long it is: a 2000-character paste is
"one line" and ~27 rows, and a window counting logical lines let the composer
alone outgrow the screen (measured 32 rows on a 24-row terminal). Its window is
anchored on the CURSOR's row rather than the tail, so editing the head of a
long paste still shows what is being edited.

## Fixed overhead is part of the budget, and a floor is not a bound

A region's own chrome — border, title, hint, the "… N more" row a window adds
as soon as it hides anything — is paid before anything is left for content, and
what remains may be nothing. `maxLiveRegionRows` clamps to 0 for exactly this
reason, and `pickerWindowSize` now does too: its old `max(2, …)` floor was a
constant that ignored the screen, and the chrome plus two items measured 9 rows
on a 9-row terminal — the picker overflowed the viewport all by itself.

When the leftovers cannot cover both the chrome and one unit of content, drop
CHROME first: a picker rendering no entry cannot be used, while its hint only
restates key bindings. Bounded-but-empty satisfies the height assertion and
fails the user, so the render test pins a visible entry alongside the bound.

`pickerWindowSize` additionally divides by the real per-item height: a picker
item that renders a preview costs two physical rows, not one.

Wrapping applies to the fixed regions too, not just the windowed ones: the key
hint and a long draft line each wrap on a narrow terminal, so the rows they are
charged in the `liveText` budget go through `wrappedRowCount` as well.

The same "a floor is not a bound" bug exists on the COLUMN axis, not just the
row axis: `pickerContentWidth` used `Math.max(20, columns - 4)`, a floor that
exceeds the real inner width on any terminal narrower than 24 columns. A
label/hint/preview truncated against that too-wide budget can still overflow
the border and wrap, which reflows the row the wrap-vs-truncate section above
assumed was exactly one row — on a narrow enough terminal this alone blew the
picker's row budget. `pickerContentWidth` now clamps to the real inner width
(floor of 4, only against a degenerate near-zero width); the downstream
label/preview width floors clamp through the same `clampToPickerWidth` helper
so neither can independently claim more than `pickerContentWidth` allows.

## Current bounds

| Region | Rows | Columns |
|---|---|---|
| `liveText` | `windowLiveTextLines`: whatever rows the fixed regions leave, with a "… N earlier lines" head; hidden entirely at zero | counted after wrapping (`wrappedRowCount`), not truncated — prose stays readable |
| `liveTools` | windowed, with a "… N more running" tail | `truncateLabel(tool.label, terminalColumns - 4)` |
| Picker items | `pickerWindowSize`: rows left after border/title/"… N more"/hint, divided by per-item height, clamped to 0; the hint is dropped before the last item | label / hint / preview each truncated to the bordered content width |
| Slash suggestions | capped list length | description truncated against the command's width |
| File suggestions | capped list length | `truncateLabel(entry.relPath, terminalColumns - 8)` |
| Prompt lines | `windowPromptRows`: PHYSICAL rows, anchored on the cursor's row, with a "… N earlier draft lines" head | pre-wrapped to the content width less the '› ' gutter, so Ink never reflows a draft row |
| Status line | single line | `formatStatusline` sheds tail segments |

## Print-style output is a different path

`/sessions`, `section()` and friends go into scrollback via `<Static>` instead of
the live region, so they are not screen-bounded — but they still take an explicit
count bound so a long history cannot flood the transcript.

## Measurement

All of it measures DISPLAY COLUMNS through `src/terminal/text-width.ts` (CJK and emoji are
two columns wide), never `String.length`. Cursor movement and deletion step whole
code points through the same module.

Already-rendered text carries ANSI colour codes, which occupy no columns, so
`stringWidth()` over-counts every styled line. `wrappedRowCount()` strips them
before measuring; anything else measuring rendered output must do the same.

## Streaming and interaction guards

- Ink transcript model: `InkUiBridge.events` is append-only and rendered via Ink `<Static>` (printed once into terminal scrollback). Never mutate an already-emitted event — stream into `liveText`/`liveTools` and finalize on boundaries (tool call, tool result, run end, abort).

- Multi-character `useInput` chunks are pastes (or coalesced typing) and must be inserted literally — never interpreted as Enter/Tab; bracketed paste additionally arrives via Ink's `usePaste` channel.

- The Ink host renders with `patchConsole: false`: `EngineLogSink` owns `console.*` (installed before engine init) and routes it to `~/.pulse-coder/logs/cli.log` + the `/debug` policy (errors surface as dim lines; warns dedupe per unique text per session; info/debug only with `/debug on`, `--verbose`, or `--verbose`). Never write to stdout directly from Ink-host code paths — it tears the frame; log via `console.*` (captured) or the bridge.

- Tool traces are gray one-line summaries by default (`label · N lines/matches`, single-line output inlined, structured output yields NO summary — never a JSON dump); failures stay red with the error inline. `Ctrl+O` toggles content previews and, per the Static model, affects only future traces.

- Assistant text is two-tier: segments finalized because a tool call started are narration (`status: 'info'`, rendered gray, no markdown); only the segment that ends a run renders bright with markdown. The status line's TEXT stays stable during a run (`Running agent · <elapsed>`) — never write per-tool churn into `status`.

- Terminal text math goes through `src/terminal/text-width.ts`: layout truncation measures DISPLAY COLUMNS (CJK/emoji are 2 wide) and cursor movement/deletion steps whole CODE POINTS. `String.length` is wrong for both — never clamp or step by it.

- The Ink host renders with `incrementalRendering: true`: Ink's default writer erases and repaints the ENTIRE live block on every frame (measured: ~2x the lines and bytes of the incremental writer over a streaming answer), and at 30fps that repaint of the status line and bordered composer is visible as shimmer. `src/ink/ink-app.screen.test.tsx` pins that the incremental writer paints the same screen as the default one.

- A live region that shrinks must be compensated by matching `<Static>` output, or the composer walks UP the screen and leaves dead rows below it. Ink writes static output in place of the erased live block, so the normal finalize-into-transcript path is already neutral — `src/ink/ink-app.screen.test.tsx` emulates a terminal across a bridge-driven run and fails if the composer jumps up more than a row. Do not "fix" this with reserved padding: holding a high-water height pins the composer mid-run but voids the screen and produces a far bigger jump when the reservation is released.

- Everything rendered BELOW `<Static>` must be bounded by terminal size on BOTH axes, and the axes are coupled — a row window is only correct if it either truncates on columns or charges each line its wrapped height. A frame taller than the viewport makes Ink wipe the screen and replay the whole transcript on EVERY frame until it shrinks back, which at streaming rate is the terminal flicker. `src/ink/ink-app.render.test.tsx` pins the frame height against a mock TTY. Detail + current bounds: `harness/knowledge/live-region-bounding.md`.
