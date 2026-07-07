# Spec: UI reuse unification

> Surface definition: `packages/engine/harness/spec/README.md`. This is the
> workspace's first PLANNED-initiative spec (normative design for a
> migration/architectural boundary, per root `harness/DESIGN.md`) rather than
> a discovered-accident entry. Same lifecycle: once decided and landed, the
> durable rules graduate to `harness/knowledge/conventions/frontend.md` (+
> mechanical checks where possible) and this entry is DELETED.

**Status: DECIDED (owner, 2026-07-07) — implementation pending. The
acceptance lines are live as a mechanical ratchet:
`src/main/__tests__/ui-reuse-governance.test.ts` (runs in `pnpm test`).
This entry is deleted when the blessed `components/ui/` set exists and the
decided rules have graduated to `conventions/frontend.md`.**

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

## Normative content — DECIDED (owner, 2026-07-07)

1. **复用判据**: the blessed set covers the BASIC capabilities — 弹窗
   (modal/dialog), 抽屉 (drawer), 消息 (toast), 按钮 (button) — plus the
   basic interaction behaviors (ESC-close, click-outside, drag-resize). For
   these patterns, new code MUST use the blessed implementation/hook;
   creating a parallel implementation requires a recorded reason (and a
   baseline raise in the governance test, which forces the recording).
   Patterns outside this set are not governed by this spec.
2. **安放处**: `components/ui/` — a new directory; blessed pieces are built
   there (or promoted into it, e.g. `SettingsDrawer`, `AppShellProvider`'s
   toast/confirm). It does not exist yet; creating it with the four basic
   capabilities IS the implementation of this spec.
3. **Token 执行策略**: new-code ratchet (no active migration); **radius
   first** — new CSS uses `var(--radius*)`, raw-px radius count may only
   shrink. Other categories (colors/shadows/z-index) stay measured but
   ungated until radius proves the mechanism. The oklch frame engine stays
   deliberately isolated for now.
4. **可验收定义** (delegated; chosen so every line is a CHECK, not a doc
   sentence — all live in `src/main/__tests__/ui-reuse-governance.test.ts`):
   - Six ratchet counters, may shrink never grow (both directions enforced —
     shrinking without lowering the baseline also fails, locking in wins):
     raw `<button>` (402), non-token `border-radius` (435), spinner
     keyframes (6), `role="dialog"` (12), `createPortal` files (10),
     hand-rolled `window keydown` in components (10).
   - Zero NEW phantom tokens: every `var(--x)` must resolve to a definition.
     The audit found **14** undefined tokens (even `AppShellProvider`
     references a nonexistent `--text-primary`); `--radius-md` is now
     defined (8px, scale midpoint), the remaining 13 are baselined in
     `KNOWN_UNDEFINED_TOKENS` — shrink-only, stale entries flagged.
   - "Unified" for a pattern = its counter reaches the level where the only
     remaining implementations are `components/ui/` + recorded exceptions.

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
