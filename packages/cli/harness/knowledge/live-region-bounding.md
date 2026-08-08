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
`<Static>`. `src/ink-app.render.test.tsx` renders the real component into a
mock TTY and asserts the frame height stays under the viewport (it measured
207 rows on a 24-row terminal before the bound existed).

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

`pickerWindowSize` additionally divides by the real per-item height: a picker
item that renders a preview costs two physical rows, not one.

Wrapping applies to the fixed regions too, not just the windowed ones: the key
hint and a long draft line each wrap on a narrow terminal, so the rows they are
charged in the `liveText` budget go through `wrappedRowCount` as well.

## Current bounds

| Region | Rows | Columns |
|---|---|---|
| `liveText` | `windowLiveTextLines`: whatever rows the fixed regions leave, with a "… N earlier lines" head; hidden entirely at zero | counted after wrapping (`wrappedRowCount`), not truncated — prose stays readable |
| `liveTools` | windowed, with a "… N more running" tail | `truncateLabel(tool.label, terminalColumns - 4)` |
| Picker items | `pickerWindowSize`, divided by per-item height | label / hint / preview each truncated to the bordered content width |
| Slash suggestions | capped list length | description truncated against the command's width |
| File suggestions | capped list length | `truncateLabel(entry.relPath, terminalColumns - 8)` |
| Prompt lines | windowed, with a "… N earlier draft lines" head | composer wraps by construction |
| Status line | single line | `formatStatusline` sheds tail segments |

## Print-style output is a different path

`/sessions`, `section()` and friends go into scrollback via `<Static>` instead of
the live region, so they are not screen-bounded — but they still take an explicit
count bound so a long history cannot flood the transcript.

## Measurement

All of it measures DISPLAY COLUMNS through `src/text-width.ts` (CJK and emoji are
two columns wide), never `String.length`. Cursor movement and deletion step whole
code points through the same module.

Already-rendered text carries ANSI colour codes, which occupy no columns, so
`stringWidth()` over-counts every styled line. `wrappedRowCount()` strips them
before measuring; anything else measuring rendered output must do the same.
