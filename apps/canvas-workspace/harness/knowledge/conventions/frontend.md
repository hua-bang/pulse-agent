# Frontend (Renderer) Conventions

Applies to `src/renderer/src/**`. The renderer is a React 18 + wouter app. It has
**no privileged access** — see [`architecture-boundaries.md`](./architecture-boundaries.md).

## Component layout

Each non-trivial component lives in its own folder under
`src/renderer/src/components/<ComponentName>/`:

```
<ComponentName>/
  index.tsx                 # the component (container/composition)
  index.css                 # colocated styles, imported via `import './index.css'`
  types.ts                  # local prop/data types (optional)
  useXxxController.ts       # heavy state/effect logic extracted to a hook (optional)
  SubComponent.tsx          # focused child components, one export each
  utils/                    # pure helpers (optional)
  __tests__/                # vitest specs (optional)
```

Example (real): `Sidebar/` is split into `SidebarHeader.tsx`, `WorkspaceList.tsx`,
`WorkspaceItem.tsx`, `FolderItem.tsx`, `LayersPanel.tsx`, `utils/`, with
`index.tsx` only wiring state to children. `AgentNodeBody/` extracts logic into
`useAgentNodeController.ts` and renders `AgentPicker` / `AgentTerminal`.

## Component style

- Export **named arrow-function components**:
  `export const FrameNodeBody = ({ ... }: Props) => { ... }`. Avoid `default`
  exports for components.
- Name the props interface **`Props`** (local) and destructure props in the
  signature.
- Import the colocated stylesheet at the top: `import "./index.css";`.
- Keep components **≤ 300 lines**; lift state machines and side effects into a
  `useXxxController` hook or split out sub-components (see file-size governance).

## Hooks

- Shared hooks live in `src/renderer/src/hooks/` named `useXxx.ts`
  (`useCanvas`, `useNodes`, `useClickOutside`, `useEscapeClose`, …).
- Component-scoped hooks may live beside the component
  (`useAgentNodeController.ts`, `Canvas/hooks/`, `chat/hooks/`).
- Hooks return typed values; keep them framework-pure (no Electron/Node imports).

## Talking to the main process

The renderer **never** imports `main`/`preload`/Electron/Node. All privileged
work goes through the typed bridge `window.canvasWorkspace` (typed by
`src/renderer/src/types.ts`, which re-exports the per-domain interfaces under
`src/renderer/src/types/*`).

- Call request/response methods via `window.canvasWorkspace.<group>.<method>()`
  (e.g. `window.canvasWorkspace.model.setCurrent(...)`).
- Subscribe to streaming events via the `onXxx(callback)` methods exposed by the
  bridge; they return an unsubscribe function — call it on cleanup.
- If you need a new capability, add the IPC handler in `src/main/<domain>/ipc.ts`,
  the bridge mapping in `src/preload/bridge/<domain>.ts`, and the type in the
  matching `src/renderer/src/types/*` group. Keep the three in sync.

## Styling

- CSS is **colocated** per component as `index.css` (plus focused extras like
  `interaction-polish.css`) and imported from the component file.
- Follow the existing design-token usage (oklch palette, frame styles) seen in
  `design/` and existing component CSS rather than hardcoding ad-hoc colors.

## UI reuse (governed — ratchet-enforced)

Decided 2026-07-07 (the spec entry completed its lifecycle — blessed set
built, rules graduated here, entry deleted; evidence lives in git history of
`harness/spec/ui-reuse-unification.md`). The counters are enforced by
`src/main/__tests__/ui-reuse-governance.test.ts` (runs in `pnpm test`; a
counter may shrink but never grow):

- **New code uses the blessed basics** from `components/ui/`: `Button`
  (including `variant="icon"` for icon-only square buttons — pass
  `aria-label`, sizes sm/md/lg = 24/28/32px), `Modal` (the one overlay
  shell), `Drawer`, `Portal` (the one createPortal exit), `Popover` (the one
  popover shell that portals to `document.body`; two anchoring modes —
  default `x`/`y` one-shot point anchor with a viewport clamp, for
  context-menu-style menus opened at a click point, or `anchorRef` for a
  LIVE trigger-rect anchor that keeps reanchoring on scroll/resize via
  `useAnchorRectPosition`, with `placement`/`align` flip+align — both modes
  share ESC/arrow-nav + click-outside),
  `DropdownShell` (the one TRIGGER-anchored dropdown shell — in-flow, no
  portal; owns click-outside/ESC/arrow-nav like Popover but stays next to
  its trigger instead of portaling to an x/y point), `Select` (the one
  dropdown; scope a density override rather than forking it), `TextField`
  (labelled input/textarea), `SectionHeader` (title+description pair for a
  settings-style section intro), `FieldRow` (generic label/control/hint
  wrapper for any non-text control — Select, checkboxes, custom widgets;
  TextField remains the blessed piece for TEXT controls), `SegmentedControl`
  (the one "pick one of N" control — `ariaPattern="radio"` or `"tab"`),
  `useDragResize`, `ui/hooks/useIndexNav` (+ its pure `clampIndexMove`
  helper for externally-driven index state), `SwatchRow` (the one row of
  pick-a-color swatches — `ariaPattern="menuitemradio"` default for rows
  inside a `role="menu"` panel, `"toggle"` for a toolbar-shaped ancestor;
  an option's `isNone: true` renders the diagonal "no color" slash instead
  of a fill), `EmptyState` (the minimal icon+title+description+action
  empty-state shell — icon/action are optional `ReactNode` slots; business
  copy, illustrations, and per-surface border/background/alignment stay
  with the caller via `className`) — plus `AppShellProvider.notify`
  for toasts and the canonical hooks `useEscapeClose` / `useMenuKeyboardNav`
  / `useClickOutside`. Do NOT hand-roll a new overlay ESC listener, backdrop,
  portal call site, point-anchored popover shell, trigger-anchored dropdown
  (local `open` state + click-outside + arrow-nav wired by hand), dropdown
  popover, labelled form field, section title/description CSS cluster
  (`*-section-title`/`*-section-desc`/`*-field`), segmented/tab-strip
  control, ArrowUp/Down index-clamp logic, spinner keyframe, row of
  pick-a-color swatch buttons, or raw CTA `<button>` style pair (including
  icon-only button chrome:
  `border:none;background:transparent;border-radius;cursor:pointer` at a
  fixed size) — the ratchet will fail your PR. The blessed spinner element
  is `icons/SpinnerIcon` (drive its rotation with a `spin`-named keyframe
  class, e.g. `chat-spin`); render it instead of inlining a fresh spinner
  `<svg>`. An icon+title+description block that is NOT a row of solid-fill
  swatches and NOT dominated by a bespoke action list/form (see
  `ChatEmptyState`'s and `CanvasEmptyHint`'s SKIP verdicts in
  `docs/ui-reuse-burndown.md`) should reach for `EmptyState` rather than a
  hand-rolled `strong`/`span` or `h*`/`p` pair.
- **Radius, colors, and shadows use tokens** in new CSS: `var(--radius-xs|--radius-sm|--radius|--radius-md|--radius-lg|--radius-xl|--radius-pill)`
  for radii, palette tokens for colors, `var(--shadow-*)` for shadows — all
  three are ratchet-gated (`borderRadiusLiterals`, `hardcodedColorLiterals`,
  `shadowLiterals`). Raw `z-index` literals >= 10 (the cross-surface
  stacking band — low local stacking inside a single component is still
  permitted) are also gated (`zIndexHighRaw`); prefer the `--layer-*` scale.
  Which token to reach for:

  | Need | Token |
  |---|---|
  | Text | `--text` (primary ink) · `--text-secondary` · `--text-muted`; aliases `--text-primary`/`--text-tertiary` |
  | Fills | `--bg` · `--surface` · `--surface-1` (dark overlay) · `--surface-2` · `--surface-alt` · `--surface-subtle` · `--note-paper` |
  | Accent | `--accent` family · `--accent-muted` · `--accent-soft` · `--accent-soft-strong` |
  | Borders | `--border` · `--border-subtle` (dark-chrome) |
  | Radius | `--radius-xs` 4 · `--radius-sm` 6 · `--radius`/`--radius-md` 8 · `--radius-lg` 10 · `--radius-xl` 12 · `--radius-pill` 999 |
  | Shadow | `--shadow-sm/-card/-card-hover/-drag/-float/-focus` |
  | Stacking | the 13-token `--layer-*` scale (see `../renderer-surfaces.md`) |

  **Exact-value tokenization only (C2, 2026-07-10):** `--radius-xs`/`--radius-xl`/
  `--radius-pill` and `--shadow-focus` were minted by replacing a literal with
  a token that resolves to the identical value — pixel-identical by
  construction, no visual review needed. `--radius-xs`/`--radius-xl` (not
  `-sm`/`-lg` as an earlier plan draft proposed) because `--radius-sm` (6px)
  and `--radius-lg` (10px) already existed and are load-bearing for `ui/`;
  reusing those names for 4px/12px would have silently changed their
  resolved value. Normalizing near-miss literals (6px/7px/10px/5px/3px/50%
  radii; 2px-ring or other-opacity shadows) onto an existing token is a
  **different, pixel-changing operation** gated behind a visual diff — do
  not fold those into a "just use the token" edit without one.

  The oklch frame-tint engine (`FrameNodeBody`) is deliberately isolated from
  this palette; its `--frame-*` dials are per-scope parameters, not tokens.
- **Every `var(--x)` must resolve**: referencing an undefined token fails the
  governance test. (The original 13 phantoms were converged into real
  definitions on 2026-07-07; only the two frame-engine dials remain
  intentionally undefined, baselined in the test.)
- Three more counters (added with the `SectionHeader`/`FieldRow`/
  `DropdownShell`/`SegmentedControl` set): `sectionFieldCssClusters` (non-ui
  CSS rule openers shaped like `*-section-title|desc|body` or `*-field`),
  `bespokeDropdownShells` (non-ui `.tsx` files pairing `useClickOutside(` +
  `useMenuKeyboardNav(` without `createPortal(` — a hand-rolled
  trigger-anchored dropdown), `segmentedRoles` (non-ui
  `role="tablist"`/`role="radiogroup"` occurrences).
- Reducing a counter? Lower its baseline in the same PR — the test fails on
  unlocked improvements too.

## Copy & i18n

- **No hardcoded user-facing strings.** Use `useI18n()` from
  `src/renderer/src/i18n`; add keys to the message catalog
  (`i18n/messages.ts`) rather than inlining English/Chinese text.

## Types

- Shared renderer types are re-exported from `src/renderer/src/types.ts`; add new
  cross-cutting types under `src/renderer/src/types/<group>.ts`.
- Canvas data shapes (`CanvasNode`, `FrameNodeData`, node-type data) are the
  contract between renderer and main — keep them JSON-safe and, where they cross
  the process boundary, prefer defining them in `src/shared/*`.
