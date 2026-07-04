# Engine Contracts

## Scope

`pulse-coder-engine` is the reusable runtime package. Hosts such as CLI, remote server, canvas workspace, ACP, and agent teams should integrate through engine options, plugins, hooks, tools, services, and run context.

Engine code should stay host-agnostic. Prefer an extension point before changing the core loop.

## Public Surface

- Package exports: `.`, `./src`, `./types`, and `./built-in`.
- Main exports: `Engine`, `PulseAgent`, `loop`, AI helpers, compaction helpers, provider builders, shared runtime types, built-in tools, and built-in plugins.
- Public types include `EngineOptions`, `LoopOptions`, `LoopHooks`, `CompactionEvent`, `EnginePlugin`, `EnginePluginContext`, `Tool`, `ToolExecutionContext`, `Context`, and `ClarificationRequest`.
- Built-in plugin exports under `pulse-coder-engine/built-in` are consumed directly by canvas and other hosts.

## Runtime Contracts

- `Engine.initialize()` creates the plugin manager, loads built-in plugins unless disabled, registers plugin tools, then merges `EngineOptions.tools` as the highest-priority override layer.
- Tool merge order is: built-in tools, plugin tools, then custom tools from `EngineOptions.tools`.
- Built-in plugin order is defined by `src/built-in/index.ts`; changing it can change runtime behavior.
- `src/core/loop.ts` owns streaming events, tool-call/result events, LLM hooks, tool hooks, run hooks, retry/backoff, abort handling, timeout handling, and context compaction.
- Hook behavior should remain composable across hosts. Do not assume a single CLI, server, or canvas caller.
- Tools should keep explicit schemas where possible and preserve `ToolExecutionContext` propagation, including `runContext`, clarification callbacks, abort signal, and `toolCallId`.
- Preserve `.pulse-coder/*` as the preferred runtime config root and `.coder/*` compatibility unless there is an explicit migration plan.

## Extension Boundary

Use these before editing the loop:

- Plugin tools for new capabilities.
- Hooks for lifecycle behavior.
- Services for shared runtime state.
- Built-in plugins for repo-wide engine features.
- Host wrappers for CLI, server, canvas, or ACP orchestration.

## Known Consumers

- `packages/cli`
- `apps/remote-server`
- `apps/canvas-workspace`
- `packages/plugin-kit`
- `packages/memory-plugin`
- `packages/langfuse-plugin`
- `packages/acp`
- `packages/agent-teams`

Contract changes should consider local validation in `../validate/` and any root impact overlay in `../../../../harness/validate/validation.yaml`.
