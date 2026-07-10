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

## Batch C0 — counter hygiene (small, independent, do first)

`shadowLiterals` (196) is inflated: 26 lines are `box-shadow: none` (not a
shadow literal) and ~5 use a real shadow token that misses the `var(--shadow`
prefix check (`var(--nodes-shadow)`). Refine the counter to exempt
whole-value `none` and whole-value shadow-purpose tokens (keep the review
lesson: geometry lines with an unrelated `var(--border)` still count).
Baseline drops honestly to ~165. Acceptance: governance suite green with new
baseline; no production CSS touched.

## Batch C1 — structural sweep (no visual gate needed)

Re-shell bespoke implementations onto blessed pieces. Behavior-testable;
pixel changes are acceptable-by-review (shells carry their own chrome).

| Item | Targets (verified 2026-07-10) | Counter movement |
|---|---|---|
| DropdownShell tail | `ShapeNodeBody/index.tsx`, `chat/ChatAnchors.tsx`, `FloatingToolbar/index.tsx`, `WorkspaceNodes/GraphPage.tsx` | bespokeDropdownShells 4 → 0 |
| Menu portals → Popover | `NoteMentionMenu/`, `FileNodeBubbleMenu/`, `chat/ModelSwitcher.tsx`, `SlashCommandMenu/` | portalFiles 9 → ~5 |
| Lightbox → Modal | `chat/ChatImageLightbox.tsx` (clears a portal + a dialog role + a keydown listener) | portalFiles −1, dialogRoles −1, handRolledKeydown −1 |
| Dialog adoption, case-by-case | `NodeMentionPicker/` and `WorkspaceNodes/NodeTagEditor.tsx` → Modal; `WorkspaceNodes/NodeDetailDrawer.tsx` → Drawer; `AgentTeamFrame/index.tsx` ×3 → Modal (re-shell ONLY — file is an over-500 baseline file, may shrink, must not grow) | dialogRoles 12 → ~5 |
| Spinner dedupe | 6 private `@keyframes *spin` (WorkspaceTerminalDock, MigrationSpinner, UpdateSection, ChatPanel, IframeNodeBody, AppShellProvider) → one blessed global, same pattern as fadeIn/menuAppear | spinnerKeyframes 6 → 1 |

**Pinned exclusions (do NOT migrate):**
- `Workbench/index.tsx` + `Workbench/WorkspaceTerminalPortal.tsx` — these
  portals are terminal-DOM reparenting (keeps PTY alive across remounts),
  not popover shells. Architectural; out of scope.
- `CommandPalette`, `ReferenceDrawer/ReferencePicker.tsx`,
  `ReferenceDrawer/ReferenceUrlEditor.tsx` — palette/popover-shaped
  surfaces; builder states a verdict per case in the PR, default keep.
- Most `handRolledKeydown` entries (`useCanvasKeyboard`, `useMarqueeSelect`,
  `useShapeDraw`, `useEdgeInteraction`, `useTemporaryHandTool`,
  `useCanvasMouseHandlers`, `useMindmapController`, `useNoteKeyboard`,
  `useNoteMentions`, `useFileNodeEditor`, `App.tsx` global shortcuts) are
  canvas-level keyboard systems, NOT popover ESC handling. That counter is a
  no-grow ratchet, not a to-zero list. Floor after C1 ≈ 14–16, and that is
  fine.

Counter floors are structural: dialogRoles/portalFiles include the blessed
primitives themselves (Modal, Drawer, Portal, Popover self-count).

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

## Standing rules

- A batch that discovers a false positive in a counter fixes the COUNTER
  (like C0), never contorts production code to satisfy it.
- New knowledge found mid-batch routes per the task-end write-back rule
  (root AGENTS.md §6).
- When stock in a counter hits its structural floor, note it in
  `frontend.md`'s UI section if the floor is non-obvious; delete this file
  when every batch here is done or abandoned — it is a project record, not
  a permanent surface.
