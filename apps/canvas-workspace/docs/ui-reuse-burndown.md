# UI-reuse stock burn-down plan

Project record (2026-07-10). The GOVERNANCE is done and live — blessed set in
`src/renderer/src/components/ui/`, double-direction ratchet in
`src/main/__tests__/ui-reuse-governance.test.ts`, policy in
`harness/knowledge/conventions/frontend.md`. This file plans the STOCK
burn-down: which frozen debt gets migrated, in what order, with what
verification. Policy stays "new-code ratchet, no forced migration" — batches
here are opportunity-ordered, not scheduled. Counter numbers below are the
2026-07-10 evidence snapshot; the ratchet baselines are the live SSOT.

## Verification reality (read before building)

- No Electron binary in the cloud container — the driver/screenshot harness
  cannot run there. Structural batches (C0/C1/C2) are verifiable by
  typecheck + vitest + ratchet alone, BY DESIGN. Anything needing app
  screenshots runs locally.
- Pure `ui/` pieces have no Electron dependency; a showcase page +
  Playwright/chromium CAN run in the container (C3 prerequisite).
- Every batch updates the ratchet baselines DOWNWARD in the same commit —
  the double-direction ratchet fails on unrecorded improvements.
- Execution protocol per batch: pinned brief → builder model → independent
  reviewer (different model) → adjudication → commit. AGENTS.md failure
  guards apply (regression test for any loop/history-shaped change).

## Batch C0 — counter hygiene — DONE 2026-07-10

Landed as planned (whole-value `none` + whole-value shadow-purpose tokens
exempt; geometry lines with an unrelated `var(--border)` still count).
Honest floor turned out to be 170, not ~165 — the plan's estimate was
computed against a stale baseline; 5 unrelated literals had drifted in via
master perf commits. Independent review confirmed the filter and the
arithmetic (200→169 at HEAD after C1's incidental deletion).

## Batch C1 — structural sweep — DONE 2026-07-10 (yield lower than projected, by evidence)

What landed (builder: Sonnet; independent review: Opus; both CONFIRMED):

| Item | Outcome | Counter movement |
|---|---|---|
| DropdownShell — `ShapeNodeBody`, `FloatingToolbar` | migrated (review added: `ariaLabel` passthrough so the shell keeps the menu's accessible name) | bespokeDropdownShells 4 → 2 |
| Lightbox → Modal — `chat/ChatImageLightbox.tsx` | migrated + 5 behavior tests | portalFiles 9→8, dialogRoles 12→11, handRolledKeydown 17→16 |
| Spinner dedupe | one blessed global `@keyframes spin` in styles.css; 6 private copies deleted, per-site durations kept | spinnerKeyframes 6→1, privateEntranceKeyframes 12→11 |

**Adjudicated misfits — do NOT retry these without an API change** (each
verified in code by builder AND spot-confirmed by the independent reviewer):

- `chat/ChatAnchors.tsx`, `GraphPage` overflow menu → DropdownShell:
  they distinguish close-by-click-outside (no focus restore) from
  close-by-keyboard (restore focus to trigger); DropdownShell's single
  internal `close` cannot express a close REASON. Unlock = add a
  close-reason to DropdownShell's API (extend-blessed-ui skill applies).
  **RESOLVED 2026-07-10 — see "API-extension batch" below; both migrated,
  `bespokeDropdownShells` 2→0.**
- `NoteMentionMenu`, `SlashCommandMenu`, `FileNodeBubbleMenu`,
  `chat/ModelSwitcher` → Popover: Popover force-autofocuses its first
  button on mount with NO opt-out (`useMenuKeyboardNav` autoFocus default),
  which would steal focus from the editor/filter input; ModelSwitcher also
  needs live reanchoring on scroll/resize which Popover's one-shot x/y
  cannot do. Unlock = `autoFocus` opt-out prop (combobox pattern) and/or
  rect-anchored live positioning.
  **PARTIALLY RESOLVED 2026-07-10 — the `autoFocus` prop landed, but
  re-verifying all four against the unlocked API surfaced a DEEPER,
  previously-unrecorded blocker for three of them (Home/End focus-steal,
  not just autofocus-on-mount) and confirmed the fourth's positioning gap
  still holds. All four remain bespoke — see "API-extension batch" below
  for the per-target reasoning; no counter movement.**
- `NodeMentionPicker`, `NodeTagEditor` → Modal / `NodeDetailDrawer` →
  Drawer / `AgentTeamFrame` ×3 → Modal: ALL are in-context anchored or
  in-flow surfaces (`position:absolute` in a local stacking context, or a
  non-modal split-view panel); Modal/Drawer's body-portal + viewport-fixed +
  focus-trap contract would CHANGE their scope, not just their chrome.
  These keep `role="dialog"` legitimately — dialogRoles' structural floor
  is ~11, not ~5 as first projected.

**Pinned exclusions (unchanged from planning, still binding):** Workbench's
two terminal-reparenting portals; CommandPalette/ReferencePicker/
ReferenceUrlEditor; the canvas-level keyboard systems in handRolledKeydown
(that counter is no-grow, not to-zero; its floor ≈ 16 = GraphPage Cmd+F+ESC
+ 2 gesture-cancel listeners + the rest of the census in the ratchet's
comments).

**Meta-lesson recorded**: the planning scan projected counter movements
(9→~5, 12→~5) from SHAPE (role/portal grep) without reading each target's
positioning contract. Actual yield: the misfit rate on "looks like a
dialog/menu" targets was 8/13. Future batch briefs must include the
positioning contract (fixed-viewport vs in-context) per target, not just
the counter hit list.

## Batch C2 — token minting + exact-value swap — DONE 2026-07-10

Replacing a literal with a token that RESOLVES TO THE SAME VALUE cannot
change rendering, so this batch needed no visual gate — typecheck + ratchet
+ a byte-equal spot-check that each minted token's value equals every
literal it replaced.

**Plan-vs-reality correction (found by the builder, not pre-cleared):** the
plan's proposed radius scale reused the names `--radius-sm: 4px` and
`--radius-lg: 12px`. Both names already existed in `styles.css` — converged
earlier at 6px and 10px respectively — and are load-bearing for `ui/`
(`Modal`, `DropdownShell`, `Select`, `SegmentedControl`, `Drawer` all
reference them). Minting over them with new values would have redefined
those tokens and silently changed ~54 already-tokenized call sites' pixels,
violating this batch's entire safety argument. Landed as `--radius-xs: 4px`
/ `--radius-xl: 12px` instead (natural extension of the existing xs<sm<md<
lg<xl ladder); `--radius-pill: 999px` had no prior name collision and landed
as planned. `--radius-md`/`8px` reused the existing token as planned.

What landed:

| Token | Value | Lines swapped | Files touched |
|---|---|---|---|
| `--radius-md` (existing) | `8px` | 69 | — |
| `--radius-xs` (new) | `4px` | 63 | — |
| `--radius-pill` (new) | `999px` | 54 | — |
| `--radius-xl` (new) | `12px` | 12 | — |
| `--shadow-focus` (new) | `0 0 0 3px rgba(35, 131, 226, 0.1)` | 9 | — |

198 radius lines + 9 shadow lines across 43 CSS files (plus `styles.css`
for the token definitions) = 44 files touched. Every swap was a whole
single-value `border-radius: <literal>;` or byte-exact
`box-shadow: 0 0 0 3px rgba(35, 131, 226, 0.1);` line; multi-value
shorthands, corner-property variants (`border-*-radius`), and near-variant
shadows (2px ring, other opacities) were left untouched by design —
normalizing those is C3's visual-gated job, not this batch's.

Counter movement (baselines lowered in the same commit,
`src/main/__tests__/ui-reuse-governance.test.ts`):

| Counter | Before | After |
|---|---|---|
| `borderRadiusLiterals` | 421 | 223 |
| `hardcodedColorLiterals` | 1968 | 1959 (side effect of the 9 rgba( swaps) |
| `shadowLiterals` | 169 | 160 |

18/18 governance tests green with the new baselines. `frontend.md`'s token
table and UI-reuse section were updated with the four new tokens and the
exact-value-only rule.

## Batch C2b — exact-value radius extension — DONE 2026-07-10

C2's own collision note (above) already established that `--radius-sm`
(6px) and `--radius-lg` (10px) pre-existed `styles.css` and are load-bearing
for `ui/`. What C2 didn't draw out: that pre-existence makes `border-radius:
6px;` and `border-radius: 10px;` literals exact-value swaps onto those two
tokens too — pixel-identical by construction, the same safety argument as
C2's four minted tokens, not a normalization judgment. The plan's C3 bullet
had deferred all of 6px/7px/10px/5px/3px as one undifferentiated
"normalization" bucket on a stale assumption (a 4/8/12 scale where 6px/10px
had no exact home); that assumption was wrong for 6px/10px specifically.

Mint nothing — both tokens already exist in `styles.css` (`--radius-sm: 6px`
at line 60, `--radius-lg: 10px` at line 59); this batch only swaps call
sites. Every WHOLE single-value `border-radius: 6px;` line became
`border-radius: var(--radius-sm);`, and every WHOLE single-value
`border-radius: 10px;` line became `border-radius: var(--radius-lg);`,
within the counter's scanned tree (`src/renderer/src` only — `src/plugins`
is out of scope, matching C2's precedent). Multi-value shorthands and
corner-property variants (`border-*-radius`) were left untouched — the
counter's regex never counted them as `border-radius:` matches to begin
with, so they weren't part of this batch's swap set.

| Value | Token | Lines swapped | Files touched |
|---|---|---|---|
| `6px` | `var(--radius-sm)` | 62 | — |
| `10px` | `var(--radius-lg)` | 37 | — |

99 lines across 26 CSS files, verified via `git diff --stat` (99
insertions/99 deletions, line-for-line).

Counter movement (baseline lowered in the same commit,
`src/main/__tests__/ui-reuse-governance.test.ts`):

| Counter | Before | After |
|---|---|---|
| `borderRadiusLiterals` | 223 | 124 |

18/18 governance tests green with the new baseline. `frontend.md` needed no
change — its token table already lists `--radius-sm`/`--radius-lg` at
6px/10px and the exact-value-tokenization note already covers this batch's
class of swap.

**C3's remaining-normalization list, corrected:** 7px / 5px / 3px / 0 /
multi-value shorthand radii remain — 6px and 10px are no longer part of
C3's normalization scope; they were exact-value swaps, done here.

## Pilot surface slice — IframeNodeBody family — DONE 2026-07-10

The first execution of C3's "migrate `rawButtonTags`/`rawInputTags` by
SURFACE SLICE, never as one global sweep" bullet — one component family,
judgment per instance, not a mechanical pass. Slice: the iframe-review
feature chrome that landed off-ratchet on 2026-07-10 (`IframeReviewLayer.tsx`
composer, `IframeRenderedView.tsx` toolbar, `index.tsx`, `iframeBar.css` +
the relevant slice of `index.css`).

Unlike C2/C2b this is not byte-identical — no Electron/screenshot harness
runs in this container (same constraint C1 worked under), so fit was judged
by reading each target's positioning/interaction contract and comparing
`ui/Button`'s/`ui/TextField`'s fixed chrome against it, per the C1 meta-lesson
("check the contract, not the tag"). Verdicts:

| Instance(s) | Location | Verdict |
|---|---|---|
| Reload, Open externally (`.iframe-empty-btn`(`--primary`)) | `IframeRenderedView.tsx` load-error card actions | **Migrated** → `ui/Button` `variant="primary"/"secondary"` `size="sm"`. Both already used `var(--border)`/`var(--surface)`/`var(--text)`/`var(--accent)` — the same tokens `ui/Button`'s literal colors resolve to in this light-only theme — and sit in a free-flowing 320px-wide centered error card with no fixed-height constraint, so `ui/Button`'s 30px floor (was 26px) and bolder weight (650 vs unset/400) are a minor, acceptable typographic normalization, the same class of change C1 accepted for its migrations. |
| Reload, Regenerate, Inspect, Review-picker, Open-externally (`.iframe-bar-btn` ×5) | `IframeRenderedView.tsx` toolbar (`.iframe-bar`) | **Skipped.** Fixed 22×22px icon buttons inside a fixed `height: 31px` bar (`padding: 4px 6px`). `ui/Button`'s icon-variant floor is 24px (`size="sm"`) — that alone overflows the bar by more than the available padding allows without touching the bar's own metrics, which is out of this migration's scope. This is exactly the toolbar-icon-button risk the brief flagged; default keep. |
| Address-bar trigger (artifact/AI/HTML modes, `.iframe-bar-url.iframe-bar-url--html`) | `IframeRenderedView.tsx` `IframeAddressButton` | **Skipped.** A compound trigger (badge span + truncated text span, sometimes a spinner) at the toolbar's fixed 22px row height — not a CTA/icon shape `ui/Button` expresses, and it lives in the same height-constrained bar as the icon buttons above. |
| URL address input (`.iframe-bar-url-input`) | `IframeRenderedView.tsx` `IframeAddressButton`, url mode | **Skipped.** A chromeless `<input>` whose border/background/focus ring all come from its `.iframe-bar-url--editable` parent wrapper at 22px. `ui/TextField` supplies its own control chrome (border, 34px height, padding, `:focus-visible` ring) plus a `<label>` wrapper — adopting it would double the chrome (wrapper's box-shadow/border fighting the parent's) rather than replace it. |
| Numbered review pins (`.iframe-review-pin`) | `IframeReviewLayer.tsx` | **Skipped.** Not button chrome — a `position: absolute`, DOM-coordinate-anchored circular marker rendered once per comment. `ui/Button`'s fixed square icon variant doesn't express a point-anchored badge; this is a different component shape entirely. |
| Close, Delete, Cancel, Add, Clear, "Send to Chat" (`.iframe-review-mini-btn`(`--primary`) ×6) | `IframeReviewLayer.tsx` popovers + pending bar | **Skipped.** Two independent misfits: (1) size — `ui/Button`'s text-variant floor is 30px (`size="sm"`) vs. the popover's deliberately compact 24px, a 25% jump inside a `width: min(260px, …)` floating annotation box; (2) color — the review popover already commits to its own bespoke slate palette (`#111827` labels, `rgba(17,24,39,…)` borders) distinct from `ui/Button`'s warm-gray secondary chrome (`#37352f`/`rgba(55,53,47,…)`), so migrating would both inflate the footprint and introduce an in-popover color clash the load-error buttons above don't have. Default keep. |
| Draft + active-comment textareas (`.iframe-review-textarea` ×2) | `IframeReviewLayer.tsx` | **Skipped.** `ui/TextField`'s multiline control has `min-height: 140px` (`textarea.ui-textfield__control`) vs. the popover's `min-height: 62px` — more than double, inside the same width-capped floating box as the buttons above. `ui/TextField`'s focus ring is also `:focus-visible`-only, which would likely drop the visible ring on the draft box's `autoFocus`-on-open (programmatic focus doesn't reliably trigger `:focus-visible`), a real behavior regression, not just a size one. |

No bespoke CSS was deleted — `.iframe-empty-btn`/`.iframe-empty-btn--primary`
are still used by `IframeEditor.tsx` (out of this slice's scope, per the
brief), so the shared rule stays; only the two `IframeRenderedView.tsx`
call sites changed their markup. No radius/color/shadow literals were
removed, so only `rawButtonTags` moves this batch.

Counter movement (baseline lowered in the same commit):

| Counter | Before | After |
|---|---|---|
| `rawButtonTags` | 398 | 396 |

18/18 governance tests green. A behavior test was added for
`IframeReviewLayer`'s composer (`IframeReviewLayer.test.tsx`, co-located next
to the component per this family's existing convention —
`useIframeNodeState.test.tsx` — following `ChatImageLightbox.test.tsx`'s
`createRoot`+`act` pattern, no testing-library): draft typing reports through
`onDraftTextChange`, Cmd+Enter saves and Escape cancels, the Add button's
disabled state gates on draft text, pin-click opens a comment's popover with
working Close/Delete, and the pending bar's Clear/Send wire to `onClear`/
`onSubmit`. `IframeRenderedView` (webview/Electron-coupled) and `index.tsx`
(pure composition, no owned behavior) were not given new tests — nothing
there is mountable or has logic worth pinning outside Electron.

## API-extension batch — DONE 2026-07-10

Implements the two C1 "Unlock = API change" bullets, then re-attempts the
misfits they name — per the C1 meta-lesson, each target's actual contract
was re-read before migrating rather than trusting the old verdict.

**API 1 — DropdownShell close-reason.** `onOpenChange` now carries an
optional second argument, `reason?: 'escape' | 'outside'`, set ONLY for the
two dismissal paths a caller might treat differently (omitted — same
single-arg call as before this option existed — for opening, a trigger
re-click close, and an item-pick close via the render-prop `close()`).
Internally this required splitting the shell's one `close` function (which
`useClickOutside` AND `useMenuKeyboardNav` were BOTH wired to — the actual
root cause of "DropdownShell's single internal `close` cannot express a
reason") into two: `closeFromOutside` and `closeFromEscape`, each calling
the shared `applyOpen(false, reason)`. Fully backward compatible: every
existing caller (ShapeNodeBody, FloatingToolbar, TextColorPicker,
FrameHeaderControls) and the pre-existing `onOpenChange` unit test compile
and pass unchanged.

**API 2 — Popover `autoFocus`.** A `boolean` prop, default `true`, passed
straight through to `useMenuKeyboardNav`'s existing `autoFocus` option.
One-line implementation; the hook already supported this, Popover just
never exposed it.

Both extensions default to prior behavior — `pnpm run visual` (11/11) is
byte-identical, unregenerated.

### Migrated

| Target | Outcome |
|---|---|
| `chat/ChatAnchors.tsx` → DropdownShell | **Migrated.** `onOpenChange`'s `reason === 'escape'` check restores focus to the trigger; outside-press and item-pick closes don't. The hover-driven open/close (mouseenter/mouseleave with a debounced close) is layered on top of the shell's own `open`/`toggle` via refs mirrored during the trigger render-prop call (an established ref-during-render pattern already used by `useClickOutside` itself), gated so hover only ever opens-when-closed or closes-when-open. A bonus simplification fell out: the shell's own arrow-key nav is GLOBAL-scope (not gated on focus being inside the panel), so the pre-migration "if already open, manually refocus the first/last item" branch on the trigger's keydown handler became dead code and was deleted — the shell's own capture-phase listener now handles it, having already run (and stopped propagation) before the trigger's own bubble-phase handler would fire. Panel CSS kept its exact pre-migration chrome (radius/shadow/background/z-index/animation/min-max-width) via a specificity-guaranteed compound selector (`.ui-dropdown__panel.chat-anchors-menu`) rather than relying on CSS import order — this is a structural move only, not a visual one. 7 new behavior tests. |
| `WorkspaceNodes/GraphPage.tsx` overflow menu → DropdownShell | **Migrated.** Same close-reason wiring. The pre-migration behavior where Pause/Resume and Density clicks deliberately leave the menu open (only Refresh explicitly closes it, via `close()`) is preserved exactly — verified by test. GraphPage.tsx **shrank**, 811→801 lines (still under its 812 must-not-grow file-size baseline), by dropping the now-redundant `useClickOutside`/`useMenuKeyboardNav` wiring, the `overflowOpen`/`overflowMenuId`/`overflowRef`/`overflowMenuRef` state, and the same now-dead "already open" arrow-key branch. Panel CSS override follows the same compound-selector pattern; `position`/`top`/`right` needed NO override at all — the shell's own `align="end"` + default `placement="bottom"` already produce byte-identical `top: calc(100% + 6px); right: 0`. 5 new behavior tests (react-force-graph-2d mocked out — a third-party canvas-rendering dependency happy-dom can't run, and one the overflow menu's own logic doesn't touch). |

`bespokeDropdownShells`: 2 → 0 (both migrated; baseline lowered in the same
commits as each migration, with provenance comments in
`src/main/__tests__/ui-reuse-governance.test.ts`).

### Re-verified — still SKIP (autoFocus alone doesn't unlock these)

All four were re-read against their FULL keyboard contract, not just the
autofocus symptom the original misfit note named. Three turned out to share
a landmine the `autoFocus` prop cannot fix at all, because it only gates
`useMenuKeyboardNav`'s FIRST effect (initial-mount focus) — its SECOND
effect (global-scope ArrowUp/Down/Home/End → DOM-focus a panel button) is
unconditional and fires regardless of `autoFocus`.

| Target | Verdict |
|---|---|
| `NoteMentionMenu` | **SKIP, deeper reason found.** Not a Popover-shaped menu at all: `role="listbox"`/`aria-selected` items with an externally-owned "active" index (`useNoteMentions.ts`'s own `window.addEventListener('keydown', ..., true)`, mounted on the editor, driving `moveMentionSelection`) — the menu itself only calls `useClickOutside`, never `useMenuKeyboardNav`, and DOM focus never enters it. That editor-level handler intercepts ArrowDown/ArrowUp/Enter/Escape with `stopImmediatePropagation()`, so adopting Popover wouldn't double-fire on THOSE keys (the editor's handler, registered first, wins). But it does **not** handle Home/End — so Popover's own unconditional Home/End branch would be the only listener left standing for those keys, and would yank DOM focus from the note's contentEditable into a menu button mid-typing. That's a real regression (Home/End inside an active `@mention` query currently does the caret's native line-start/end move), not present today, and `autoFocus={false}` does nothing to prevent it. Combined with the role/selection-model mismatch, this is a controlled-listbox shape Popover's contract doesn't serve — same conclusion `bespokePopoverPositioning`'s existing baseline comment already drew, now with the concrete mechanism. |
| `SlashCommandMenu` | **SKIP, same reason.** Structurally identical to NoteMentionMenu — `useFileNodeEditor.ts`'s own capture-phase handler owns ArrowDown/Up/Enter/Escape via `moveSlashSelection`/`closeSlashMenu`; the menu itself never calls `useMenuKeyboardNav`. Same Home/End focus-steal gap, same `role="listbox"` mismatch. |
| `FileNodeBubbleMenu` | **SKIP, original blocker re-confirmed, plus a second one found.** Re-read `useViewportClampedPosition` (the hook both DropdownShell... no, both Popover and the mention/slash menus share): it only clamps a top-left point back from the viewport edges — it does not flip above/below an anchor, nor center horizontally around one. FileNodeBubbleMenu needs both (`translate(-50%, ...)` horizontal centering around the selection midpoint, plus a measured flip-below when there's no room above) — Popover still lacks this, so the original verdict holds. Newly found: the bubble menu opens on EVERY non-empty text selection (`onSelectionUpdate` in `useFileNodeEditor.ts`) and today hand-rolls no keyboard nav at all (no `useClickOutside`, no `useMenuKeyboardNav`, no Escape). Popover's unconditional Home/End handling would hijack the browser's native "collapse selection to line start/end" — an extremely common edit action — every time ANY text is selected in the note editor, a severe regression, not a corner case. |
| `chat/ModelSwitcher.tsx` → Popover | **SKIP, re-confirmed unchanged.** Still hand-rolls its own `updateMenuPosition` (measures the trigger rect, flips above/below based on available space, re-runs on `resize` and capture-phase `scroll`) — exactly the live-reanchoring Popover's one-shot `useViewportClampedPosition` clamp cannot do. Also doesn't match `bespokePopoverPositioning`'s file signature (no `useViewportClampedPosition` import), so this was never actually counted by the ratchet either way — no counter movement possible regardless of verdict. |

No counter movement from this sub-batch (all four skips); `bespokePopoverPositioning` stays at 2 (NoteMentionMenu + SlashCommandMenu — unchanged, its existing baseline comment's reasoning is now independently re-confirmed with the specific mechanism above).

**Skill write-back**: `extend-blessed-ui/SKILL.md` gained a 6th landmine —
a narrow opt-out prop only disables the ONE effect it's wired to; a shared
hook's OTHER unconditional effects (here, `useMenuKeyboardNav`'s Home/End
arrow-nav, independent of its `autoFocus` gate) can still conflict with a
caller's own external keyboard ownership. Check the primitive's FULL
behavior surface against the caller's FULL keyboard contract, not just the
named symptom, before promising an unlock.

## Blessed-set expansion — SwatchRow + EmptyState — DONE 2026-07-10

Not a stock-burndown batch — an EXPANSION of the blessed set itself
(`harness/skills/extend-blessed-ui/SKILL.md`'s procedure, run twice), adding
two new `components/ui/` pieces and migrating their exemplar call sites.

### ui/SwatchRow

Evidence read in full before designing: `TextNodeBody/TextColorPicker.tsx`
(+ `TextSelectionBubble.tsx`), `FrameNodeBody/FrameHeaderControls.tsx`,
`ShapeNodeBody/index.tsx` (fill + stroke rows), `EdgeStylePanel/index.tsx`
(color row). The real common shape: a `role="group"` row of small circular
swatch buttons, one active at a time (`role="menuitemradio"`/`aria-checked`
inside a menu ancestor, or `aria-pressed` for a toolbar ancestor via
`ariaPattern="toggle"`), an optional `isNone` slot rendered as a diagonal
"no color" slash, click picks and always `stopPropagation()`s. API:
`options: {value, label, isNone?}[]`, `value`, `onChange(value)`,
`ariaLabel?`, `ariaPattern?`.

**Interaction-contract check (the C1 meta-lesson) — per-swatch mousedown
handling turned out to be dead code at the 2 sites that had it (the other
2 never did — review corrected an earlier "3 of 4" miscount here).**
TextColorPicker's
swatches called `e.preventDefault()` on mousedown, but `DropdownShell`'s
`onPanelMouseDown={(e) => e.preventDefault()}` (set on that same
DropdownShell instance) already covers the WHOLE panel surface — redundant.
FrameHeaderControls' swatches called `e.stopPropagation()` on mousedown, but
`DropdownShell`'s panel unconditionally `stopPropagation()`s every mousedown
over its own surface regardless of `onPanelMouseDown` — also redundant.
ShapeNodeBody and EdgeStylePanel never had per-swatch mousedown handling to
begin with (an ancestor wrapper already covered it). Net: `SwatchRow` needs
NO mousedown handling of its own; every migrated site's existing ancestor
already owns it. `onClick` DOES need `stopPropagation()` internally, however
— unlike mousedown, two of the four sites relied on it specifically to keep
a color pick from reaching a canvas node's own click-to-select handler, and
no ancestor already covers `click` the way `DropdownShell`'s panel covers
`mousedown`.

| Site | Verdict |
|---|---|
| `TextNodeBody/TextColorPicker.tsx` (text + bg color rows) | **Migrated.** Both `TextColorTrigger` instances' preset `.map()` now render `SwatchRow`; the bg row's "None" preset becomes `isNone`. |
| `FrameNodeBody/FrameHeaderControls.tsx` (`FrameColorPicker`) | **Migrated.** No `isNone` preset in this row. |
| `ShapeNodeBody/index.tsx` (`ShapeStylePicker`'s fill + stroke rows) | **Migrated**, fill + stroke rows only. The THIRD row (`STROKE_WIDTHS`) is a bar-chart-shaped width picker, not color swatches — correctly out of `SwatchRow`'s scope, left bespoke. Pre-migration these swatches were SQUARE (`--radius-xs`); `SwatchRow`'s one canonical shape is circular (matching the other three sites) — a deliberate visual unification, same class of minor normalization Batch C1 accepted for cross-site Button height differences. |
| `EdgeStylePanel/index.tsx` (color row only) | **Migrated**, color row only. The width/style/head/tail rows are SVG line/dash/cap PREVIEWS, not color fills — a different component shape, correctly left bespoke. EdgeStylePanel keeps its own hand-rolled chip+popover shell (`useMenuKeyboardNav` called directly, not via `DropdownShell`) — `SwatchRow` only replaced the row of buttons inside it, proving the piece works standalone, not just inside `DropdownShell`. |
| `chat/TextNodeBody/TextSelectionBubble.tsx` | **SKIPPED.** Two independent misfits found on close reading: (1) its "text color" row isn't solid-fill swatches at all — each button shows a colored letter glyph (`style={{color: preset.value}}` on the text, neutral `rgba(0,0,0,0.04)` background), a fundamentally different visual shape `SwatchRow` doesn't express; (2) its "highlight" row IS solid-fill swatches, but shares its wrapper markup/CSS classes and a trailing non-preset "clear" action button with the (non-fitting) text-color row — carving out only the highlight half would fragment one visually-matched toolbar into a migrated half and a bespoke half, a worse outcome than leaving both bespoke. No counter movement from this site. |

Counter movement (baselines lowered in the same commit, with provenance
comments in `src/main/__tests__/ui-reuse-governance.test.ts`):

| Counter | Before | After | Why |
|---|---|---|---|
| `rawButtonTags` | 396 | 392 | 5 per-site preset `<button>` declarations (Text, Frame, Shape×2, Edge) collapsed onto SwatchRow's one; +1 for SwatchRow itself. |
| `borderRadiusLiterals` | 124 | 122 | 3 `border-radius: 50%;` swatch declarations (Text, Frame, Edge) collapsed onto SwatchRow's one; +1 for SwatchRow itself. (Shape's swatch was already `var(--radius-xs)`, no change either way.) |
| `hardcodedColorLiterals` | 1959 | 1952 | 11 rgba()/hex literals across the four sites' swatch CSS (mostly `rgba(0,0,0,alpha)` borders/rings) tokenized onto `var(--border)`/`var(--text-muted)`/the existing `var(--surface)`+`var(--accent)` active ring; SwatchRow's own CSS adds only its 3-line `--none` diagonal-slash rule (no existing token for that red — same "content palette, not chrome" class the ratchet's own top comment already carves out). |
| `shadowLiterals` | 160 | 157 | 4 counted `box-shadow` lines (Text/Frame's literal active rings, EdgeStylePanel's base ring + its ALREADY-token-only active ring — still counted because the exemption requires the substring `var(--shadow` specifically) collapse onto SwatchRow's one reused declaration. |

No new counter minted for "bespoke swatch row" shape. Unlike
`bespokeDropdownShells` (a precise function-call signature —
`useClickOutside(` + `useMenuKeyboardNav(` without `createPortal(`), a
swatch row's signature would be something like ".map() rendering a
`<button>` with a `background`/`backgroundColor` style" — indistinguishable
by regex from many unrelated buttons (tinted icon buttons, status badges,
…). Per the skill's guidance, noted here rather than adding a flaky counter.

### ui/EmptyState

Evidence read: `chat/ChatEmptyState.tsx`, `ReferenceDrawer/ReferenceEmptyState.tsx`
(the two named sites), plus a grep for other inline empty-state layouts
across `components/**/*.css` (`grep -rn "\-empty\b\|Empty"`). That grep
surfaced several MORE candidates: `Sidebar/LayersPanel.tsx`'s
`sidebar-layers-empty` (title+description, no icon), `WorkspaceNodes`'
`NodesPage.tsx`/`GraphPage.tsx` (`h2`+`p`, no icon, ALREADY sharing one CSS
selector — real, demonstrated 2-site duplication), `CanvasEmptyHint/index.tsx`
(icon+title+description PREAMBLE, then a much larger bespoke action-grid +
URL form + shortcuts button), and several single-line "no results" messages
(`chat/ModelSwitcher.tsx`, `NodeMentionPicker`, `CommandPalette`) with no
icon/title/description structure at all — too thin to be this shell's
concern.

API: `icon?`, `title`, `description?`, `action?` (all `ReactNode` except
`className`), rendered as a bare `display:flex; flex-direction:column`
column with NO forced `align-items`/`text-align` — flex `stretch` makes
every child a full-width block, so a caller's own `text-align:center`
(ReferenceEmptyState) or the browser default `left` (LayersPanel, which
sets neither) both fall out of ONE shared layout for free, with zero
override CSS needed for either. Title/description typography is fixed
(14px/650/`--text`, 12px/1.6/`--text-secondary` — ReferenceEmptyState's
exact pre-migration values); icon/action styling and business copy stay
with callers.

| Site | Verdict |
|---|---|
| `ReferenceDrawer/ReferenceEmptyState.tsx` | **Migrated.** icon (its own `.reference-empty-icon` tile, passed as the `icon` prop, untouched) + title + description + action (the conditional `.reference-selected-hint` block). `.reference-empty h3`/`p` typography rules deleted (now `ui/EmptyState`'s own, byte-identical values); the icon's own `margin-bottom: 14px` and the hint's own `margin-top: 16px` both normalize onto `EmptyState`'s uniform `gap: 8px` (a minor, documented spacing normalization — no screenshot harness reaches full-app panels in this container, so this follows the same "read the contract, accept minor normalization" precedent Batch C1 used for Button height differences). |
| `Sidebar/LayersPanel.tsx` (`sidebar-layers-empty`) | **Migrated.** Title + description only, no icon, no action. Its decorative dashed-border box (`margin`/`padding`/`border`/`border-radius`) stays as its own class, layered on top of `ui/EmptyState` via a compound selector (`.ui-emptystate.sidebar-layers-empty`, same override pattern as `.ui-dropdown__panel.text-color-popover`) so it wins regardless of CSS import order. Pre-migration typography (`strong` 12px/`--text-secondary`, `span` 11px/`--text-muted`) normalizes up ~1-2px and a shade darker onto `EmptyState`'s fixed values — the same class of minor, documented normalization as the icon/action spacing above. |
| `chat/ChatEmptyState.tsx` | **SKIPPED.** Two real misfits, not a forced-in judgment call: (1) no description at all — just an icon and a one-line greeting, then the empty state's actual CONTENT is a repeating quick-actions list plus a conditional configure-banner, not a small trailing "action" appendage; (2) its layout is bottom-anchored and left-aligned (`justify-content: flex-end; align-items: flex-start` on the pre-existing wrapper) — inverted from every other candidate's centered-column shape. Squeezing the quick-actions list into `action` would pass ~90% of the component's real content through one opaque slot, reducing no real duplication. |
| `CanvasEmptyHint/index.tsx` | **SKIPPED.** Only its preamble (icon 56px tile + title + description inside a bordered/shadowed card) matches; everything below — a primary-actions grid, two more action-grid sections, a URL composer form, a shortcuts button — is bespoke onboarding UI with no equivalent in `EmptyState`'s minimal contract. Also not one of the two originally-named evidence sites for this batch; a future batch could still carve out just its preamble if that specific duplication becomes worth it on its own evidence. |
| `WorkspaceNodes/NodesPage.tsx` + `GraphPage.tsx` (`h2`+`p`, sharing one CSS selector) | **SKIPPED, scale mismatch.** A real, demonstrated 2-site duplication, but a page-level empty state, not a compact-panel one: pre-migration the `h2`/`p` used NO explicit font-size at all (pure browser UA default, ≈21px bold / 14px normal against this app's 14px body base) — a full head-and-a-half larger than `ReferenceEmptyState`'s pre-migration 14px/12px. `EmptyState`'s sibling pieces (`SectionHeader`, `FieldRow`) each ship exactly ONE fixed typography scale, no size variant — matching that house convention here would force a page-level heading down to drawer-hint size, the same "visual downgrade" reasoning the governance test's own `segmentedRoles` baseline comment already used to keep 3 card-style radiogroups off `SegmentedControl`. Left as frozen stock; revisit only alongside an explicit size variant, not by forcing today's fixed scale. |
| `chat/ModelSwitcher.tsx`, `NodeMentionPicker`, `CommandPalette` (single-line "no results" messages) | **Not evidence — too thin.** A single `<div>{message}</div>`, no icon/title/description split. Forcing the full shell onto a one-liner would be the abstraction-for-its-own-sake the Occam rule warns against. |

No ratchet counter moved from this piece — the deleted CSS (title/description
typography, spacing) contained zero radius/color/shadow literals, so
`hardcodedColorLiterals`/`borderRadiusLiterals`/`shadowLiterals` are
untouched by this half of the batch (confirmed: governance stayed 18/18
green with no `EmptyState`-caused baseline change needed).

### Showcase / visual-gate defect found and fixed

Adding two new sections to `harness/tools/ui-showcase/src/Showcase.tsx`
initially perturbed FIVE pre-existing, untouched baselines
(TextField/Select/DropdownShell sections showed sub-pixel text
anti-aliasing diffs; Modal/Drawer/Popover's full-viewport screenshots showed
visibly different background content). Root-caused, not blessed as
"expected churn":

1. Inserting the new sections BEFORE existing ones shifted every later
   section's on-page Y position, which changes the scroll offset Playwright
   lands on when scrolling a section locator into view for its screenshot —
   confirmed via diff images (pure text-antialiasing noise). Fix: append
   new sections LAST, after every pre-existing one, so no existing section's
   position changes.
2. Modal/Drawer/Popover assert on a full VIEWPORT screenshot (they portal to
   `document.body`, so their own section's bounding box doesn't contain
   them). Their trigger buttons' `.click()`-driven auto-scroll was landing
   at the page's max-scroll CLAMP (`document.scrollHeight - viewport
   height`), confirmed by directly probing `window.scrollY` before and
   after this batch's changes (795px both times, coincidentally, until
   proven otherwise — see below). Appending ANY content anywhere in the
   page raises max scroll and un-clamps that landing spot, changing what's
   visible. Fixed with an explicit, self-computing scroll pin
   (`pinScrollForModalTrio` in `ui-showcase.visual.ts`) derived from
   `section-popover`'s OWN geometry plus the showcase root's pre-existing
   120px trailing padding — a value that depends only on content up to and
   including Popover, never on what's appended after it.
3. Even with the pin, Popover's screenshot still showed the new SwatchRow
   section's heading peeking into the bottom of the viewport: the pinned
   scroll's viewport window happened to land exactly where the OLD page's
   blank trailing padding used to be, and the new sections now occupy part
   of that same window. Fixed with an explicit 200px spacer
   (`.showcase-modal-trio-spacer`, documented in both `Showcase.tsx` and
   `showcase.css`) between `PopoverSection` and the new sections — a
   generous margin above the measured ~92px shortfall.

`full-page.png` legitimately changed (the page is taller — two new sections
plus the spacer) and is the intended new baseline. Every other pre-existing
PNG (`button.png`, `section-header.png`, `field-row.png`,
`segmented-control.png`, `text-field.png`, `select-closed.png`,
`select-open.png`, `dropdown-shell.png`, `modal-open.png`, `drawer-open.png`,
`popover-open.png`) is verified byte-identical (`pnpm run visual` green,
zero diff, before adding the two new PNGs). `swatch-row.png` and
`empty-state.png` are the only new baseline files.

**Skill write-back**: this is a reusable landmine for any FUTURE showcase
addition, not specific to this batch — recorded in the showcase's own
`README.md`/inline comments (the `pinScrollForModalTrio` helper and the
spacer) rather than only here, since the next piece added to this page will
hit it again if it doesn't know to look.

**Independent-review fixes (Opus, 2026-07-10)**: (1) the
`data-menu-autofocus` marker had been INERT since introduction —
`useMenuKeyboardNav`'s single comma-selector returned the first DOM-order
button, never prioritizing the marked one, silently defeating
selected-item-focus in ui/Select, EdgeStylePanel, and the SwatchRow hosts;
fixed with a two-step lookup + a Select test whose selected option is LAST
(a first-option test cannot distinguish the behaviors). Menus that mark a
selected item now genuinely open with focus on it. (2) EmptyState gained
`titleAs` (default `div`); ReferenceEmptyState restores its pre-migration
`<h3>` so the drawer's document outline keeps its heading (LayersPanel's
old `<strong>` was presentational emphasis, already carried by the title's
font-weight — stays on the default). (3) the mousedown "3 of 4" miscount
above was corrected to 2-of-4.

## Settings/panel surface slice — DONE 2026-07-11

The first SETTINGS-FAMILY slice of C3's "migrate `rawButtonTags`/
`rawInputTags` by SURFACE SLICE" bullet, following the "pilot surface slice"
precedent (IframeNodeBody, 2026-07-10) — one component family, per-instance
judgment, not a mechanical pass. This slice is exactly the surface the pilot
predicted would fit: `src/renderer/src/components/Settings/` (the global
settings drawer's sections) and `src/renderer/src/components/settings-config/`
(the Skills/MCP/Plugins CRUD managers shared by global settings and the
per-workspace drawer). Unlike the pilot, this slice is NOT a near-miss —
`settings-config.css`'s own header comment already documented that its
`cfg-primary-btn`/`cfg-secondary-btn`/`cfg-danger-btn` (30px, `var(--radius-md)`,
`#2383e2`/`#fff`/`#37352f`) and `cfg-input`/`cfg-textarea` (34px, same border/
focus-ring) were the DOMINANT cluster `ui/Button` and `ui/TextField` were
literally built from (see each piece's own JSDoc). Several MORE near-twin
button clusters turned up in `Settings/*.css` (`agent-section-*-btn`,
`experimental-section-*-btn` — byte-identical CSS to agent-section's,
`built-in-tool-*-btn`, `updates-section-*-btn`) — un-consolidated stock from
before `ui/Button` existed, now absorbed.

Census (raw `<button>`/`<input>`/`<textarea>`/native-select instances,
production files only, one JSX declaration counted regardless of `.map()`
repeat count — matching the ratchet's own counting):

| File | Raw (btn/input/textarea) | Migrated | Skipped — verdict |
|---|---|---|---|
| `Settings/index.tsx` | 1 / 0 / 0 | 0 | 1 button: `.settings-rail-item` — a vertical nav-rail row (label + description, two lines), not a CTA/tab shape either `ui/Button` or `ui/SegmentedControl` expresses. Same class of skip as RightDock's tab strip (governance's own `segmentedRoles` comment). |
| `Settings/AgentSection.tsx` | 4 / 0 / 0 | 4 buttons | — |
| `Settings/BuiltInToolsSection.tsx` | 3 / 2 / 0 | 2 buttons + 2 inputs | 1 button: "Clear stored" — `.built-in-tool-actions .built-in-tool-secondary-btn` overrides to a borderless/transparent "ghost" style to de-emphasize it next to Save; `ui/Button`'s `secondary` variant is always bordered+white, no ghost variant exists. Stayed hand-rolled; base `.built-in-tool-secondary-btn` CSS simplified to just this one surviving ghost declaration. |
| `Settings/ChannelConfigPanel.tsx` | 3 / 3 / 0 | 0 | All 6: deliberately styled as a distinct translucent dark-chrome sub-panel (`--surface-1: rgba(0,0,0,0.2)`, `--border-subtle: rgba(255,255,255,0.14)`, literal `border-radius: 7px`) nested inside the (otherwise opaque light) `ExperimentalSection` feature list — `--accent` resolves to the same `#2383e2` everywhere, but the surface/border tokens are unique to this file and render a visibly muted-gray card, not `ui/Button`'s/`ui/TextField`'s opaque white chrome. Same class of skip as the iframe review popover's bespoke slate palette (pilot slice). |
| `Settings/ExperimentalSection.tsx` | 3 / 1 / 0 | 3 buttons | 1 input: the feature-toggle switch (`type="checkbox"` driving a track+thumb visual) — a switch component, not a text field; no `ui/` equivalent exists yet. |
| `Settings/LanguageSection/index.tsx` | 1 / 0 / 0 | 0 | 1 button: the language `role="radio"` option — already evaluated and left as frozen stock by the governance test's own `segmentedRoles` comment (card/grid chooser, a different visual language than `SegmentedControl`'s compact pill). Re-confirmed, not re-litigated. |
| `Settings/UpdateSection.tsx` | 2 / 0 / 0 | 2 buttons | — |
| `settings-config/McpManager.tsx` | 14 / 8 / 4 | 12 buttons + 7 inputs + 4 textareas | 2 buttons: `.cfg-expander` disclosure-triangle toggles (18×18px, compact icon-row chrome — same skip class as the pilot slice's iframe toolbar icon buttons). 1 input: `deferTools` checkbox (not a text field). |
| `settings-config/McpManagerParts.tsx` | 0 / 1 / 0 | 0 | 1 input: per-tool enable checkbox (not a text field; file untouched). |
| `settings-config/PluginsManager.tsx` | 7 / 3 / 0 | 7 buttons + 2 inputs | 1 input: hidden `type="file"` picker, triggered programmatically via ref, no visible label/chrome for `ui/TextField` to replace. |
| `settings-config/SkillsManager.tsx` | 9 / 4 / 2 | 9 buttons + 3 inputs + 2 textareas | 1 input: hidden `type="file"` picker (same shape as PluginsManager's). |
| **Total** | **47 / 22 / 6 = 75** | **39 buttons + 14 inputs + 6 textareas = 59** | **8 buttons + 8 inputs = 16** |

Notes on the migrated set:
- `McpManager.tsx`'s and `SkillsManager.tsx`'s multi-line textareas
  (`jsonText`/`mdText`/`draft.body`, all pre-migration `rows={10}`) kept
  `rows={10}` explicitly — `rows`-driven intrinsic height (~214px) is TALLER
  than `ui/TextField`'s CSS `min-height: 140px` floor, so dropping `rows`
  would have silently shrunk these fields. `args`/`env`/`headers`
  (pre-migration `rows={3}`) had the opposite relationship — `rows={3}`'s
  intrinsic height is already smaller than the 140px CSS floor, so the floor
  was already winning pre-migration; `rows` was dropped there with zero
  visual change.
- A new `.cfg-textarea-mono` helper (`font-family: var(--font-mono);
  font-size: 12.5px;`) preserves the one visual difference `ui/TextField`'s
  textarea doesn't carry — monospacing for SKILL.md/JSON/args/env/headers
  content — passed via `className`, which lands on the control per
  `ui/TextField`'s contract.
- `PluginsManager.tsx`'s `PluginConfigEditor` fields sit in a CSS grid
  (`.cfg-plugin-config-row`); `ui/TextField`'s own `.ui-textfield` wrapper
  already carries `min-width: 0` and an equivalent `flex-column` layout, so
  no extra `className` was needed to preserve the grid-item behavior once
  `.cfg-plugin-config-field`'s now-redundant `min-width: 0` was deleted.
- Bespoke dead CSS was deleted, not left orphaned: the per-section button
  clusters (`agent-section-*-btn`, `experimental-section-*-btn`,
  `updates-section-*-btn`, `built-in-tool-field`/`built-in-tool-primary-btn`)
  and the shared `settings-config.css` rules
  (`cfg-primary-btn`/`cfg-secondary-btn`/`cfg-danger-btn`, base `cfg-input`/
  `cfg-textarea`, `select.cfg-input`, the now-unreachable
  `.cfg-list-actions .cfg-secondary-btn/.cfg-danger-btn` compact override,
  the small-viewport button-width media rule) are gone. `settings-config.css`
  shrank from 665 to 557 lines; `SkillsManager.tsx` 510→498 (file-size
  baseline 510, still a must-not-grow ceiling, not moved — same treatment
  GraphPage.tsx got in the API-extension batch); `McpManager.tsx` 780→748
  (baseline 786, likewise not moved).

Counter movement (baselines lowered in the same commit, with provenance
comments in `src/main/__tests__/ui-reuse-governance.test.ts`):

| Counter | Before | After |
|---|---|---|
| `rawButtonTags` | 392 | 353 |
| `rawInputTags` | 54 | 40 |
| `rawTextareaTags` | 15 | 9 |
| `borderRadiusLiterals` | 122 | 121 |
| `hardcodedColorLiterals` | 1952 | 1893 |
| `shadowLiterals` | 157 | 154 |
| `sectionFieldCssClusters` | 14 | 12 |

18/18 governance tests green with the new baselines. `pnpm --filter
canvas-workspace typecheck` clean. `pnpm run visual` 13/13, every baseline PNG
byte-identical (settings panels are not in the showcase — confirms this slice
never touched a `ui/` piece's own chrome, only call sites). Full `npx vitest
run`: 971 passed, the same 5 pre-existing Electron-dependent files fail
(`Electron failed to install correctly` — a container/environment limitation,
not a regression: `main/__tests__/{codex-sessions,welcome-workspace,
workspace-export-external-files}.test.ts`,
`main/agent/__tests__/knowledge-tools.test.ts`,
`plugins/main/__tests__/external.test.ts`). `node
harness/tools/describe-canvas.mjs` exits 0, no drift.

**Behavior tests — not added, stated plainly.** Every migrated file in this
slice loads and mutates its data by calling `window.canvasWorkspace.*`
directly inside effects/callbacks (`skills.*`, `builtInTools.*`,
`experimental.*`, `appInfo.checkForUpdates`, `canvasSkills.*`, `canvasMcp.*`,
`canvasPlugins.*`) with no props-level injection seam — the same shape as
`WorkspaceSettings/index.tsx` (this family's own migrated reference, also
untested for the identical reason). No test anywhere in this renderer mocks
`window.canvasWorkspace`; introducing that mocking convention is new test
infrastructure, out of scope for a per-instance chrome migration. This
matches the brief's own escape hatch and the established precedent — these
panels are too IPC-coupled to mount meaningfully without it.

**Independent-review corrections (Opus, 2026-07-11 — verdict SOUND).**
"Pixel-identical" holds exactly for the settings-config `cfg-*` cluster
(radius/heights/colors byte-equal to ui/Button/TextField) but NOT for two
recorded normalizations: (1) the deleted per-row compact overrides
(`.cfg-list-actions` 26px, `.cfg-plugin-config-actions` 28px) mean list-row
action buttons now render at ui/Button's 30px `sm` — a deliberate +2–4px
convergence, consistent with the 统一收编 direction, recorded here rather
than over-claimed away; (2) `Settings/*.css`'s near-twin section buttons
(6px radius / 12.5px / weight 500-600) normalized to the blessed 8px/12px/
650 — same accepted class of change as Batch C1's Button heights. The one
USER-visible regression the review caught — the ≤520px full-width button
stacking rule died with the deleted `.cfg-*-btn` selectors — was FIXED
(`.cfg-pane .ui-btn { width:100% }` restored at that breakpoint).

## Batch C3 — normalization + the big two (visual gate first)

**Prerequisite — DONE 2026-07-10**: `ui/` showcase page + Playwright
screenshot baseline, at `apps/canvas-workspace/harness/tools/ui-showcase/`
(full detail: its own `README.md`). A plain-React vite page (zero
Electron/preload imports, confirmed by construction — every `ui/` piece
only imports React/DOM/local hooks/CSS) mounts all 10 visual pieces (Button,
Modal, Drawer, Popover, DropdownShell, Select, TextField, SectionHeader,
FieldRow, SegmentedControl — `Portal` and the `useDragResize`/`useIndexNav`
hooks have no chrome of their own, exercised implicitly/covered by existing
unit tests) in their meaningful variants/states. One Playwright spec
(`@playwright/test` 1.61.1, added as a canvas-workspace devDependency)
boots a production build (`vite build` + `vite preview` — more
deterministic than the dev server) and captures 12 baseline PNGs (per-piece
sections + one full-page shot) against a fixed 1200×900 viewport with
animation/transition/caret-blink disabled. Two full clean-state runs
(killed server, deleted `dist/`, rebuilt from scratch each time) produced
**zero diffs** against the same baselines — confirms the setup is
reproducible, not just "usually passes."

Run it: `pnpm run visual` (compare) / `pnpm run visual:update` (regenerate)
from `apps/canvas-workspace`. **Linux-only** — screenshots are
Linux-rendered (fonts differ per OS); a macOS run will diff on font metrics
alone and that is not a regression. Kept out of `pnpm test` (vitest) on
purpose — it's platform-bound, so it must stay opt-in, not part of the
default gate every contributor runs.

**What this does NOT cover**: full-app panels (Settings drawers, canvas
context menus, chat UI, …) that compose `ui/` pieces with app state and
Electron IPC — those still need a real Electron app and
`harness/tools/driver/` locally; there is no Electron binary in this
container. This showcase only proves the `ui/` pieces themselves render
deterministically in isolation, which is exactly what C3's screenshot-diffed
normalization work below needs (before/after a radius/shadow literal swap,
diff the piece that owns it — not a full app screen).

Then, in this order of tractability:

- Radius/shadow NORMALIZATION (the 7px/5px/3px/0/multi-value judgment
  calls — 6px/10px turned out to be exact-value swaps, done in C2b), screenshot-
  diffed per surface.
- `rawButtonTags` (390) / `rawInputTags` (54): migrate by SURFACE SLICE
  (one panel or component family per batch), never as one global sweep —
  each instance needs a variant-mapping judgment; 390 judgments do not fit
  one reviewable batch.
- `hardcodedColorLiterals` (1934): wait for a theming/dark-mode style
  forcing function and burn once with leverage. Do not start on its own.

## Drift recording (2026-07-10)

While C0/C1 ran, the ratchet caught real off-ratchet drift merged to master
(iframe-review feature `8d848aa`/`d247f20` and the perf series): raw
buttons 390→398, textareas 13→15, radius 416→421, colors 1934→1968, plus
Workbench/index.tsx 512→516 (file-size) and a renderer unit test tripping
import-boundaries (fixed: test files are now excluded from the boundary
scan, matching the sibling suites). Baselines were raised to measured with
provenance comments — RECORDED as new stock, not approved as allowance.
This is the first confirmed bite of the known "no automatic trigger" gap
(root AGENTS.md §4): nothing runs these suites for work that doesn't know
about them.

## Standing rules

- A batch that discovers a false positive in a counter fixes the COUNTER
  (like C0), never contorts production code to satisfy it.
- New knowledge found mid-batch routes per the task-end write-back rule
  (root AGENTS.md §6).
- When stock in a counter hits its structural floor, note it in
  `frontend.md`'s UI section if the floor is non-obvious; delete this file
  when every batch here is done or abandoned — it is a project record, not
  a permanent surface.
