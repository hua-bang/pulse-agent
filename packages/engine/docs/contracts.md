# Engine Contracts

## Scope

`packages/engine` provides the reusable Pulse Coder runtime. Hosts such as the CLI, remote server, canvas workspace, and teams runtime should integrate through engine options, plugins, tools, services, and hooks.

## Public Contracts

- `Engine.initialize()` creates a plugin manager, loads built-in plugins unless disabled, registers plugin tools, then merges custom `EngineOptions.tools` with highest priority.
- The core loop in `src/core/loop.ts` owns streaming text/tool events, LLM hooks, tool hooks, run hooks, retry/backoff, abort handling, and context compaction.
- Built-in tools live under `src/tools/`.
- Built-in plugins are registered from `src/built-in/index.ts`.
- Plugin authors use the engine plugin context to register tools, hooks, services, config, events, and logging.

## Invariants

- Host-specific behavior should not be hardcoded into the core loop.
- Tool contracts should remain explicit and schema-backed where possible.
- Custom tools supplied via engine options remain the highest-priority override layer.
- Hook behavior should stay composable: `beforeRun`, `afterRun`, LLM hooks, tool hooks, and compaction hooks should not assume a single host.
- Legacy `.coder/*` compatibility should not be removed without an explicit migration plan.

## Extension Boundaries

Use these extension points before editing the loop:

- Plugin tools for new capabilities.
- Hooks for lifecycle behavior.
- Services for shared runtime state.
- Built-in plugins for repo-wide engine features.
- Host wrappers for CLI/server/canvas-specific orchestration.

## Consumers

Known consumers include:

- `packages/cli`
- `apps/remote-server`
- `apps/canvas-workspace`
- `packages/agent-teams`
- `packages/orchestrator`

Contract changes should consider affected consumers and validation escalation in `../../harness/validation.yaml`.

## Validation

See `docs/validation.md`.
