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

- **New code uses the blessed basics** from `components/ui/`: `Button`,
  `Modal` (the one overlay shell), `Drawer`, `Portal` (the one createPortal
  exit), `Popover` (the one point-anchored popover shell — portals + viewport
  clamp + ESC/arrow-nav + click-outside for context-menu-style menus opened at
  an x/y point), `Select` (the one dropdown; scope a density override rather
  than forking it), `TextField` (labelled input/textarea), `useDragResize` —
  plus `AppShellProvider.notify` for toasts and the canonical hooks
  `useEscapeClose` / `useMenuKeyboardNav` / `useClickOutside`. Do NOT
  hand-roll a new overlay ESC listener, backdrop, portal call site,
  point-anchored popover shell, dropdown popover, labelled form field, spinner
  keyframe, or raw CTA `<button>` style pair — the ratchet will fail your PR.
  The blessed spinner element is `icons/SpinnerIcon` (drive its rotation with
  a `spin`-named keyframe class, e.g. `chat-spin`); render it instead of
  inlining a fresh spinner `<svg>`.
- **Radius, colors, and shadows use tokens** in new CSS: `var(--radius-sm|--radius|--radius-md|--radius-lg)`
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
  | Radius | `--radius-sm` 6 · `--radius`/`--radius-md` 8 · `--radius-lg` 10 |
  | Shadow | `--shadow-sm/-card/-card-hover/-drag/-float` |
  | Stacking | the 13-token `--layer-*` scale (see `../renderer-surfaces.md`) |

  The oklch frame-tint engine (`FrameNodeBody`) is deliberately isolated from
  this palette; its `--frame-*` dials are per-scope parameters, not tokens.
- **Every `var(--x)` must resolve**: referencing an undefined token fails the
  governance test. (The original 13 phantoms were converged into real
  definitions on 2026-07-07; only the two frame-engine dials remain
  intentionally undefined, baselined in the test.)
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
