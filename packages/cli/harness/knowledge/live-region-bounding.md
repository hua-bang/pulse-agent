# Bounding the live region

Everything rendered BELOW Ink `<Static>` shares one screen with the composer, so
every such region must be bounded by terminal size. An unbounded `.map()` there
pushes the composer off screen. Check this when adding any live region.

## The two axes are coupled

Rows and columns are not independent budgets. A row window is only correct if
every row is actually **one physical row** — Ink's default `wrap='wrap'` reflows
long text onto extra rows, silently breaking a window that was computed assuming
one row per item. So a region that windows on rows must ALSO truncate its text on
columns.

`pickerWindowSize` additionally divides by the real per-item height: a picker
item that renders a preview costs two physical rows, not one.

## Current bounds

| Region | Rows | Columns |
|---|---|---|
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
