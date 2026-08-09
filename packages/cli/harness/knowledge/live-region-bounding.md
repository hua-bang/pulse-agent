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
