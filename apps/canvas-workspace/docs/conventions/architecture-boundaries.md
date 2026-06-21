# Architecture & Boundary Rules

These rules are **enforced by tests** (`src/main/__tests__/import-boundaries.test.ts`
and `file-size-governance.test.ts`). Violating them fails `pnpm --filter
canvas-workspace test`.

## Process layers (surfaces)

The app is split into four source surfaces with a strict dependency direction:

| Surface | Path(s) | Role |
|---------|---------|------|
| `shared` | `src/shared/**`, `src/plugins/types.ts` | Runtime-neutral, JSON-safe contracts/types shared across processes |
| `main` | `src/main/**`, `src/plugins/main/**` | Privileged Electron main process: Node/Electron APIs, IPC handlers, services |
| `preload` | `src/preload/**` | Context-bridge only — maps IPC channels to the typed `window.canvasWorkspace` API |
| `renderer` | `src/renderer/src/**`, `src/plugins/renderer/**` | Browser/React UI; no privileged access |

### Allowed import directions

- **`shared`** must stay runtime-neutral: **no** imports of `main`, `preload`,
  `renderer`, plugin code, Electron, or Node builtins. Put common contracts here
  and invert dependencies toward it.
- **`renderer`** must **not** import `main`, `preload`, Electron, or Node
  builtins. Reach privileged capabilities only through the typed
  `window.canvasWorkspace` API (see [`frontend.md`](./frontend.md)).
- **`main`** must **not** import `renderer` or `preload` implementation. Share
  cross-process types through `src/shared/*`.
- **`preload`** is a bridge: **no** importing `renderer`/`main` implementation.
  Cross-process API contracts belong in `src/shared/*`; policy stays in `main`.

> Known debt: cross-process API contracts (`CanvasWorkspaceApi` and friends)
> still live in `src/renderer/src/types.ts`, so preload bridges currently import
> them via an explicit allowlist in `import-boundaries.test.ts`. The migration
> goal is to move those contracts into `src/shared/*` and delete the allowlist
> entries. **Do not add new preload→renderer imports** — extend the shared
> contracts instead.

## File-size governance

`file-size-governance.test.ts` measures every production `.ts`/`.tsx`/`.css`
file (excludes tests, `.d.ts`, generated, and documented data files):

- **> 400 lines** — recorded as a warning (informational only).
- **> 500 lines** — **hard fail** unless the file is in the `CURRENT_OVER_500_BASELINE`
  map, and baseline files **must not grow** beyond their recorded size.

Practical rules:

- **New files must be ≤ 500 lines.** Aim much lower.
- **Target ≤ 300 lines per component/module** — split by responsibility rather
  than growing a file. The split playbook used in this app: a container keeps
  state + composition; sub-components, `utils/`, `types.ts`, and a
  `useXxxController.ts` hook carry the rest (see [`frontend.md`](./frontend.md)).
- When you touch a baseline file, prefer to **shrink** it; never push it larger.

## Refactor discipline

When restructuring (from `docs/main-domain-modules.md`):

- Prefer **domain folders** over technical buckets (`services/`, `utils/`,
  global `ipc/`). Only create a shared folder when a file is genuinely shared
  across domains.
- **Preserve IPC channel names and the preload API shape** during structural
  moves — move files first, split large files after imports and tests are green.
- Keep Electron app-lifecycle code (`src/main/app/`) separate from product
  capability domains.
