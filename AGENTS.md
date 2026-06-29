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

Root-level guidance should route work to the right local entry, then the local `AGENTS.md` should carry the package-specific map, boundaries, and validation notes. Primary source code lives under each package/app `src/` directory; build output goes to `dist/`.

## Workspace Entry Index

| Workspace | Local entry | Start there when the change touches |
|---|---|---|
| `packages/engine` | `packages/engine/AGENTS.md` | engine loop, providers, prompts, tools, hooks, plugins, context, or public runtime API |
| `packages/cli` | `packages/cli/AGENTS.md` | terminal UX, sessions, slash commands, ACP/team/memory wiring, or CLI sandbox registration |
| `packages/acp` | `packages/acp/AGENTS.md` | ACP JSON-RPC clients, child processes, external agent sessions, permissions, or file handlers |
| `packages/pulse-sandbox` | `packages/pulse-sandbox/AGENTS.md` | sandboxed JavaScript execution or the `run_js` tool adapter |
| `packages/agent-teams` | `packages/agent-teams/AGENTS.md` | team runtime, task state, review gates, verification metadata, handoffs, or team protocol APIs |
| `packages/orchestrator` | `packages/orchestrator/AGENTS.md` | generic DAG planning, routing, scheduling, agent runners, artifacts, or aggregation |
| `packages/plugin-kit` | `packages/plugin-kit/AGENTS.md` | worktree binding, vault binding, devtools timelines, or reusable plugin infrastructure |
| `packages/memory-plugin` | `packages/memory-plugin/AGENTS.md` | memory services, recall/write policy, embeddings, daily logs, layered storage, or memory tools |
| `packages/langfuse-plugin` | `packages/langfuse-plugin/AGENTS.md` | Langfuse traces, generations, tool spans, compaction events, or observability hooks |
| `packages/canvas-cli` | `packages/canvas-cli/AGENTS.md` | `pulse-canvas` CLI commands, canvas store inspection/mutation, or runtime-control helpers |
| `packages/canvas-nodes` | `packages/canvas-nodes/AGENTS.md` | external Canvas node plugins, manifests, capability providers, renderers, or webview node apps |
| `apps/remote-server` | `apps/remote-server/AGENTS.md` | HTTP/webhook runtime, platform adapters, internal routes, devtools, or remote session wiring |
| `apps/teams-cli` | `apps/teams-cli/AGENTS.md` | terminal host behavior for agent teams run/plan/interactive workflows |
| `apps/canvas-workspace` | `apps/canvas-workspace/AGENTS.md` | Electron workbench, canvas persistence, Canvas Agent, teams UI, plugins, webviews, PTYs, or app harness |

## Auxiliary App Directories

These directories are useful context, but they are not active pnpm workspaces in the repository harness unless `pnpm-workspace.yaml` is expanded:

- `apps/coder-demo`: legacy standalone experimental app; its placeholder test script is expected to fail.
- `apps/devtools-web`: auxiliary Vite devtools UI that can be served by `apps/remote-server` when built.
- `apps/canvas-plugin-react-mf-note-demo`: standalone Canvas external plugin demo with its own package flow.

## Build, Test, and Development Commands
- `pnpm install`: install workspace dependencies.
- `pnpm run build`: build core workspaces recursively.
- `pnpm run dev`: watch mode for packages.
- `pnpm start`: run the CLI (`pulse-coder-cli`).
- `pnpm test`: run package tests (`./packages/*`).
- `pnpm run test:apps`: run tests for app workspaces matched by pnpm filters.
- `node harness/tools/graph-viewer/server.mjs --once`: validate the harness data behind the dashboard once.
- `pnpm --filter pulse-coder-engine typecheck`: strict TS typecheck for engine.

Useful package targets:
- `pnpm --filter pulse-coder-engine test`
- `pnpm --filter pulse-coder-cli test`
- `pnpm --filter pulse-sandbox test`
- `pnpm --filter pulse-coder-memory-plugin test`
- `pnpm --filter @pulse-coder/remote-server build`
- `pnpm --filter @pulse-coder/remote-server dev`

Use the affected workspace entry and `harness/validation.yaml` before picking checks. Some local entries document package commands that are intentionally absent or currently red; do not promote those commands to root-level defaults until the package itself is cleaned up.

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
