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
- `NoteMentionMenu`, `SlashCommandMenu`, `FileNodeBubbleMenu`,
  `chat/ModelSwitcher` → Popover: Popover force-autofocuses its first
  button on mount with NO opt-out (`useMenuKeyboardNav` autoFocus default),
  which would steal focus from the editor/filter input; ModelSwitcher also
  needs live reanchoring on scroll/resize which Popover's one-shot x/y
  cannot do. Unlock = `autoFocus` opt-out prop (combobox pattern) and/or
  rect-anchored live positioning.
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

## Batch C3 — normalization + the big two (visual gate first)

Prerequisite: `ui/` showcase page + Playwright screenshot baseline
(chromium works in-container for pure ui/ pieces; full-app panel baselines
need local Electron). Then, in this order of tractability:

- Radius/shadow NORMALIZATION (the 6px/7px/10px judgment calls), screenshot-
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
