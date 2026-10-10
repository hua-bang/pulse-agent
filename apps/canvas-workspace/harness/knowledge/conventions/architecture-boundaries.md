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

Cross-process API contracts (`CanvasWorkspaceApi` and the per-domain `*Api`
interfaces) live in `src/shared/api/*`. `src/renderer/src/types.ts` re-exports
them for renderer code. `import-boundaries.test.ts` has no preload allowlist:
any preload→renderer import fails.

A type exported from `src/shared` is declared only there. Other layers import
it or re-export it (`export type { X } from '.../shared/...'`); a second
declaration with the same name drifts silently. `shared-contract-governance.test.ts`
fails on a new redefinition. Its list of intentional redefinitions (plugin SDK
views, on-disk schemas, stricter store rows) may only shrink.

## Dead code

`pnpm --filter canvas-workspace deadcode` runs knip (`knip.json`). It fails on
unused files, unused exports and types, and duplicate exports. Tests count as
entry points, so an export that only a test uses is not dead. Delete dead code
instead of keeping it for later. When an export must stay without a static
caller (a lazy namespace import, a surface hidden on purpose), tag it
`/** @keep <reason> */`. `knip.json` `ignore` lists whole files kept on purpose,
such as the engine type shim.

## File-size governance

`file-size-governance.test.ts` measures every production `.ts`/`.tsx` file
(excludes tests, `.d.ts`, generated, and documented data files; CSS is
deliberately NOT governed — see the `GOVERNED_EXTENSIONS` comment in the test):

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

The same test limits flat production files per directory: at most 24, or 12
under `src/main` and `src/plugins/main`. Directories in
`CURRENT_FLAT_DIRECTORY_BASELINE` must not grow. When one shrinks, lower its
baseline, and remove it once the directory is within the limit. Split a
directory by responsibility (for example `agent/tools/canvas/` and
`agent/tools/web/`), not by count alone.

## Refactor discipline

When restructuring (from `harness/knowledge/main-domain-modules.md`):

- Prefer **domain folders** over technical buckets (`services/`, `utils/`,
  global `ipc/`). Only create a shared folder when a file is genuinely shared
  across domains.
- **Preserve IPC channel names and the preload API shape** during structural
  moves — move files first, split large files after imports and tests are green.
- Keep Electron app-lifecycle code (`src/main/app/`) separate from product
  capability domains.
