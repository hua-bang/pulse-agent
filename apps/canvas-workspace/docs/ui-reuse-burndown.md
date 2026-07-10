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

## Batch C2 — token minting + exact-value swap (pixel-identical by construction)

Replacing a literal with a token that RESOLVES TO THE SAME VALUE cannot
change rendering, so this batch needs no visual gate — only typecheck +
ratchet + spot-check that each minted token's value equals the literal it
replaces.

Radius histogram (416 literals): 8px ×74, 4px ×63, 6px ×62, 999px ×61,
10px ×38, 50% ×31, 7px ×27, 5px ×20, 12px ×14, 3px ×13, rest long-tail.

1. **Decision slot (needs owner sign-off):** the radius scale. Proposed:
   `--radius-sm: 4px`, `--radius-md: 8px` (exists), `--radius-lg: 12px`,
   `--radius-pill: 999px`; `50%` stays literal (circle geometry, not a
   design token).
2. Mechanical swap of EXACT matches only: ~212 radius instances
   (74+63+61+14) plus the focus-ring shadow cluster
   (`0 0 0 2-3px rgba(35, 131, 226, …)` ×~19 → `--shadow-focus`).
3. **Explicitly out of scope:** normalizing 6px/7px/10px/5px/3px to scale
   values — that CHANGES pixels and waits for C3's visual gate (or per-case
   owner approval). Do not mint tokens for every stray value either —
   token-washing without convergence is the failure mode.

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
