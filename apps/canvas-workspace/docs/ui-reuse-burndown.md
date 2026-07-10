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
