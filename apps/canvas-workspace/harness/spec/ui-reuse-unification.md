# Spec: UI reuse unification

> Surface definition: `packages/engine/harness/spec/README.md`. This is the
> workspace's first PLANNED-initiative spec (normative design for a
> migration/architectural boundary, per root `harness/DESIGN.md`) rather than
> a discovered-accident entry. Same lifecycle: once decided and landed, the
> durable rules graduate to `harness/knowledge/conventions/frontend.md` (+
> mechanical checks where possible) and this entry is DELETED.

**Status: evidence base complete (two-scan audit, 2026-07-07). Normative
sections below marked 【待裁决】 are OWNER DECISIONS — this entry is not
actionable until they are filled in.**

## Current state (verified)

### A. The token system exists and is alive — but massively bypassed

- One canonical token root: `src/renderer/src/styles.css` `:root`, 45 custom
  properties (colors, 5 shadows, 3 radii, fonts, dims, the 13-token
  `--layer-*` scale). **1,175 `var(--…)` usages** prove it is load-bearing.
- Yet **~2,021 hardcoded color literals** in renderer CSS bypass it (851 hex
  + 1,139 rgb/rgba + 31 oklch). Concentration: `chat/ChatPanel.css` (431) +
  `AgentTeamFrame/index.css` (348) hold **39%** of the total.
- Radius/shadow tokens are **~86% bypassed**: 507 `border-radius` decls, only
  ~72 via token — and the most common raw values (`8px`×73, `6px`×66,
  `10px`×37) duplicate existing `--radius`/`--radius-sm`/`--radius-lg`
  exactly. 238 `box-shadow` decls → 144 distinct value strings, 34 via token.
- z-index: 20/119 declarations use the documented `--layer-*` scale; sampled
  violations of the workspace's own rule include `NodeContextMenu/index.css:3`
  and `Sidebar/index.css:897` (`position:fixed; z-index:1000` full-app
  surfaces on raw numerics).
- **Live token gap**: `--radius-md` is referenced 7× across 6 files but never
  defined, with three different fallbacks (`10px`, `6px`, none) — verified.
- A second, isolated color model exists: the parametric oklch frame-tint
  engine in `FrameNodeBody/index.css` (31 calls, prototyped in
  `design/frame-color.html`), not wired to the `:root` palette.

### B. The natural experiment: consolidation works here, but only with a push

Same codebase, two sibling seeds, opposite outcomes:

- `useClickOutside`: **18 users, ~3 stragglers** (one semantics-different) —
  effectively consolidated; every menu dismissal routes through the hook.
- `useEscapeClose` (+ `useMenuKeyboardNav` wrapping it): **~22 users** for
  menus/popovers — yet **9–12 components hand-roll window ESC listeners**
  for overlay-close, including `CommandPalette`, `ChatImageLightbox`,
  `AppShellProvider`'s own two dialogs, and the shared `SettingsDrawer`
  wrapper itself (`index.tsx:37-44`, bubble-phase, no IME guard — verified).
  `useCanvasKeyboard` additionally hand-rolls a third, canvas-level ESC
  router. (Count range = two independent scans with different semantic
  inclusion rules; pin the number with a mechanical check when the
  acceptance line below is decided.)

Conclusion the evidence supports: this codebase CAN converge on a seed
(click-outside did), but convergence does not persist without a stated rule
and a check — which is exactly what this spec exists to decide.

### C. Duplication clusters (distinct implementations of the same pattern)

| Pattern | Evidence |
|---|---|
| Buttons | **402 raw `<button>` across 95 files, zero shared Button component**; ≥8 near-identical primary/secondary CTA class pairs — e.g. `cfg-primary-btn` vs `workspace-settings-primary-btn` differ only in height 30↔34px (verified) |
| Overlays/dialogs | ≥9 independent implementations; 12 `role="dialog"` across 10 files, only `SettingsDrawer` is reused (2 consumers); **3 different backdrop-close techniques** coexist |
| Panel drag-resize | 4–5 components each hand-capture `startX/startWidth` + own `mousemove/mouseup` window listeners; no shared hook |
| Spinners | **6 separate 360°-rotate `@keyframes`** definitions, no shared class |
| Portals | 10 `createPortal` call sites, all → `document.body`, no shared wrapper |
| Tab strips | 3 implementations (only RightDock is store-backed) |
| Toasts | `AppShellProvider.notify()` (14 users) + 1 local re-implementation (`DynamicAppNodeBody/Inspector`) |
| Entrance animations | ≥6 independently-named fade/scale-in keyframes; the global `menuAppear` in `styles.css` goes unused by the others |

### D. Existing reuse seeds (the blessed-list starting material)

`AppShellProvider` (toast + confirm dialog, 18 importers — the de facto
shared overlay primitive) · `SettingsDrawer` (only reused drawer shell) ·
`NodeContextMenu`/`EdgeContextMenu` (twin canonical menus) ·
`useClickOutside` / `useEscapeClose` / `useMenuKeyboardNav` /
`useViewportClampedPosition` · `icons` (30 importers) · `ime` guard (28).
**No `components/shared|common|ui` directory exists** — there is no formal
design-system layer to put a blessed component in today.

## Normative content 【待裁决 — owner decisions】

1. **复用判据(一句话)**: when MUST a component/hook be reused vs created
   new? 【待裁决 — e.g. "an interaction pattern with an existing seed must
   use the seed; creating a parallel implementation requires a recorded
   reason" — wording and strictness are the owner's call】
2. **钦定清单与安放处**: which patterns get a blessed implementation first
   (Button? overlay shell? `useDragResize`? shared spinner? Portal wrapper?),
   and where do shared pieces live (a new `components/ui/`? promote in
   place?) 【待裁决】
3. **Token 执行策略**: hardcode 禁令的范围与节奏 — new-code-only ratchet
   (like the perf bundle gates) vs. active migration; which category first
   (colors / radius / shadow / z-index)? Is the oklch frame engine integrated
   into the palette or deliberately isolated? 【待裁决】
4. **可验收定义**: what measurable line means "unified"? Candidates the
   evidence supports: raw-`<button>` count ratchet; `var()` adoption % per
   category; zero hand-rolled overlay-ESC (mechanically checkable); zero
   undefined-token references. 【待裁决 — pick the lines; each chosen line
   should become a check, not a doc sentence】

## Non-goals of this entry

Migration order, refactor steps, PR sequencing — that is plan/tasks material
(and a skill once the motion recurs). This entry carries WHAT + WHY only.

## Verification

Evidence from two independent scans (pattern census + style-system audit,
2026-07-07), cross-checked where they overlapped; spot-verified by hand:
`--radius-md` 7 refs / 0 defs with divergent fallbacks; the twin CTA classes;
absence of any shared Button/ui directory; `SettingsDrawer/index.tsx:37-44`
hand-rolled ESC. Known scan discrepancy (ESC hand-roller count 9 vs ≥15)
recorded in §B with the reconciliation rule. First fix already extracted as
a defect: undefined `--radius-md` (see `harness/knowledge/known-defects.md`).
