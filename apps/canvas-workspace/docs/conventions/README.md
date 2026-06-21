# Canvas Workspace — Coding Conventions

Reusable, enforced conventions for the `canvas-workspace` app. These are the
rules `CLAUDE.md` / `AGENTS.md` point at; read the relevant file before writing
or reviewing code in this app.

| Doc | Scope |
|-----|-------|
| [`architecture-boundaries.md`](./architecture-boundaries.md) | Process layers (`shared` / `main` / `preload` / `renderer`), import rules, file-size governance — **enforced by tests** |
| [`frontend.md`](./frontend.md) | Renderer (React) component, hook, styling, i18n, and IPC-consumption conventions |
| [`backend.md`](./backend.md) | Main process (Electron) domain modules, IPC, services, persistence conventions |

## Why these exist

Two vitest suites in `src/main/__tests__/` turn the most important rules into CI
gates, so they are not optional style preferences:

- `import-boundaries.test.ts` — enforces the layer import rules in
  [`architecture-boundaries.md`](./architecture-boundaries.md).
- `file-size-governance.test.ts` — blocks new/growing files over 500 lines.

When in doubt, run `pnpm --filter canvas-workspace test` — a boundary or
file-size violation fails the build with a message pointing at the offending
line.

## Baseline rules (apply everywhere)

- **TypeScript strict** mode is on. No `any` escape hatches without cause.
- **Match the file you are editing** for quote style, import order, and spacing.
  Observed defaults: renderer/preload tend to use double quotes; main and test
  files use single quotes. 2-space indent, semicolons, ESM imports throughout.
- **Keep diffs minimal** and preserve existing architecture patterns; extend
  plugin/hook/IPC boundaries rather than hardcoding behavior.
- **Tests live in `__tests__/`** (or `*.test.ts`) and run on **vitest**.
- **Cross-package imports** use workspace package names
  (`pulse-coder-engine`, `pulse-coder-agent-teams`), not relative paths into
  `../../packages/*`.
