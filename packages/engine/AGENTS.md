# AGENTS.md - packages/engine

> Local entry for `packages/engine`.
> Repository harness entry: `../../harness/README.md`.

## Module Positioning

`pulse-coder-engine` owns the reusable Pulse Coder runtime: the `Engine`/`PulseAgent` public API, provider selection, prompt assembly, context compaction, the streaming/tool execution loop, plugin lifecycle, hooks, services, built-in tools, and built-in plugins.

It should stay host-agnostic. CLI, remote server, canvas, ACP, and teams-specific behavior should integrate through options, plugins, hooks, tools, or services rather than being hardcoded into the core loop.

## Knowledge Navigation

| Task | Read |
|---|---|
| Package overview and scripts | `README.md`, `package.json` |
| Public contracts and validation | `docs/contracts.md`, `docs/validation.md` |
| Public exports | `src/index.ts` |
| Engine bootstrap and options | `src/Engine.ts` |
| Execution loop, streaming, retry, abort, compaction | `src/core/loop.ts`, `src/context/` |
| Provider, model, and prompt behavior | `src/config/index.ts`, `src/ai/index.ts`, `src/prompt/` |
| Plugin lifecycle, hooks, services, config plugins | `src/plugin/EnginePlugin.ts`, `src/plugin/PluginManager.ts`, `src/plugin/UserConfigPlugin.ts` |
| Built-in plugin order and exports | `src/built-in/index.ts`, `src/built-in/*/` |
| Built-in tool registry and schemas | `src/tools/index.ts`, `src/tools/` |
| Focused behavior tests | `src/core/loop.test.ts`, `src/plugin/plugin-manager.test.ts`, `src/built-in/**/*.test.ts`, `src/tools/*.test.ts` |

## Local Constraints

- Prefer plugin, hook, tool, or service extension points over engine-loop hardcoding.
- Preserve tool merge order: built-in tools, then plugin tools, then `EngineOptions.tools` as the highest-priority override layer.
- Built-in plugins are loaded automatically unless `disableBuiltInPlugins` is set; adding, removing, or reordering them can affect CLI, remote server, canvas, and agent teams consumers.
- Keep source imports ESM-style and follow package-local TypeScript strictness.
- Public exports, `EngineOptions`, hook signatures, service names, built-in tool schemas, and built-in plugin behavior are contracts; route changes through `../../harness/skills/contract-coding.md`.
- Preserve `.pulse-coder/*` paths and legacy `.coder/*` compatibility unless there is an explicit migration plan.
- Runtime feedback that changes engine guidance should route through `../../harness/skills/feedback-governance.md`.

## Common Commands

```bash
pnpm --filter pulse-coder-engine test
pnpm --filter pulse-coder-engine typecheck
pnpm --filter pulse-coder-engine build
pnpm --filter pulse-coder-cli test
pnpm --filter @pulse-coder/remote-server build
```

Default checks are `test` and `typecheck`. Use `build` for public exports or package configuration changes. The CLI and remote-server commands are escalation checks for public API, built-in plugin, or tool contract changes. Docs-only changes only need referenced path/command checks per `docs/validation.md`.

## Key Files

- `src/index.ts`: public exports, including the `PulseAgent` alias and built-in plugin/type exports.
- `src/Engine.ts`: engine bootstrap, provider/model option resolution, plugin/tool merge order, compaction helper, and plan-mode service helpers.
- `src/core/loop.ts`: streaming loop, LLM/tool hooks, retries/backoff, abort handling, timeout handling, tool results, and context compaction.
- `src/plugin/`: plugin manager, hook map, service/config APIs, dependency ordering, and user config plugin loading.
- `src/built-in/index.ts`: built-in plugin registration order and public built-in plugin exports.
- `src/tools/index.ts`: built-in tool registry for file, shell, Tavily, image generation, clarification, and deferred demo tools.
- `docs/contracts.md`, `docs/validation.md`: package contract and validation source of truth.
