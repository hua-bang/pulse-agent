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
