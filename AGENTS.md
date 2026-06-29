# Repository Guidelines

## Repository Harness

The active repository-level harness source of truth is `harness/`. Use it as a progressive map, not as a document dump:

```text
AGENTS.md / CLAUDE.md
-> harness/README.md
-> harness/profile.yaml
-> affected workspace entry
-> workspace contracts/spec/runbook/validation as needed
```

`.pulse-coder/` is product/runtime configuration and test surface for Pulse Coder itself; do not treat it as the source of truth for this repository harness pilot.

## Project Structure & Module Organization
This repo is a `pnpm` monorepo with all `packages/*` workspaces plus selected app workspaces listed in `pnpm-workspace.yaml`.

- `packages/engine`: core agent engine, built-in tools, plugin loading, and runtime loop.
- `packages/cli`: interactive terminal CLI built on `pulse-coder-engine`.
- `packages/pulse-sandbox`: sandboxed JS execution runtime and `run_js` tool adapter.
- `packages/memory-plugin`: memory integration/service package.
- `apps/remote-server`: optional HTTP service wrapper around the engine.
- `apps/teams-cli`: CLI host for agent teams workflows.
- `apps/canvas-workspace`: Electron canvas workbench.

Other `apps/*` directories may be legacy, standalone, or auxiliary projects; do not treat them as active pnpm workspaces unless `pnpm-workspace.yaml` includes them.

Primary source code lives under each package/app `src/` directory; build output goes to `dist/`.

## Build, Test, and Development Commands
- `pnpm install`: install workspace dependencies.
- `pnpm run build`: build core workspaces recursively.
- `pnpm run dev`: watch mode for packages.
- `pnpm start`: run the CLI (`pulse-coder-cli`).
- `pnpm test`: run package tests (`./packages/*`).
- `pnpm run test:apps`: run tests for app workspaces matched by pnpm filters.
- `pnpm --filter pulse-coder-engine typecheck`: strict TS typecheck for engine.

Useful package targets:
- `pnpm --filter pulse-coder-engine test`
- `pnpm --filter pulse-coder-cli test`
- `pnpm --filter pulse-sandbox test`
- `pnpm --filter pulse-coder-memory-plugin test`
- `pnpm --filter @pulse-coder/remote-server build`
- `pnpm --filter @pulse-coder/remote-server dev`

Note: legacy or standalone app directories are outside the active pnpm workspace set unless listed in `pnpm-workspace.yaml`.

## Remote server notes (`apps/remote-server`)
- Entry point: `apps/remote-server/src/index.ts` bootstraps session store, memory integration, worktree binding, and engine.
- HTTP server: `apps/remote-server/src/server.ts` mounts `/health`, webhook routes, and `/internal/*` routes.
- Dispatcher: `apps/remote-server/src/core/dispatcher.ts` owns signature verification, fast ack, command parsing, and streaming.
- Sessions: stored in `~/.pulse-coder/remote-sessions` with `index.json` + `sessions/*.json`.
- Memory logs: stored in `~/.pulse-coder/remote-memory` via `pulse-coder-memory-plugin`.
- Worktree binding: stored in `~/.pulse-coder/worktree-state` via `pulse-coder-plugin-kit`.
- Internal API: `/internal/agent/run` is loopback-only and requires `INTERNAL_API_SECRET`.
- Platform adapters: Feishu and Discord are mounted; Telegram/Web adapters exist but are not enabled by default.

## Coding Style & Naming Conventions
Use TypeScript with strict mode and keep style consistent with neighboring files:
- 2-space indentation, semicolons, and single quotes in most TS code.
- `PascalCase` for classes/types (`Engine`, `PluginManager`).
- `camelCase` for variables/functions.
- `kebab-case` for multi-word file names (`session-commands.ts`).
- `UPPER_SNAKE_CASE` for exported constants.

No repository-wide ESLint/Prettier enforcement is guaranteed; keep diffs minimal and focused.

## Testing Guidelines
Vitest is used across core packages. Name tests `*.test.ts` or `*.spec.ts` and keep them near related source files.

Add tests for behavior changes in:
- loop control and compaction behavior,
- plugin/tool registration and hook behavior,
- CLI command handling and session workflows,
- memory integration boundaries.


## Commit & Pull Request Guidelines
Follow Conventional Commits (scope optional):
- `feat(engine): ...`
- `fix(cli): ...`
- `chore: ...`

PRs should include:
- clear summary and affected package(s),
- linked issue (if applicable),
- test evidence (commands and results),
- terminal evidence/screenshots for CLI UX changes when relevant.

## Security & Configuration Tips
- Keep secrets in local `.env` files only (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `TAVILY_API_KEY`, `GEMINI_API_KEY`, etc.).
- Never commit credentials, local session data, or private memory databases.
- Prefer `.pulse-coder/*` config paths; legacy `.coder/*` paths exist for compatibility.
