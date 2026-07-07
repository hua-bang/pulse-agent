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
| Public contracts | `harness/knowledge/contracts.md` |
| Architecture map + runtime invariants | `harness/knowledge/architecture.md` |
| Plugin mechanism and authoring | `harness/knowledge/plugin-system.md` |
| Loop lifecycle, timeouts, retries | `harness/knowledge/loop-lifecycle.md` |
| Built-in tools reference | `harness/knowledge/tools-reference.md` |
| Embedding the engine in a host | `harness/knowledge/host-integration.md` |
| Validation | `harness/validate/README.md`, `harness/validate/validation.yaml` |
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
- Built-in plugins are loaded automatically unless `disableBuiltInPlugins` is set; adding, removing, or reordering them can affect CLI, remote server, canvas, and agent teams consumers. remote-server and canvas disable the defaults and hand-assemble their own ordered lists — new default plugins do NOT propagate to them automatically.
- Keep source imports ESM-style and follow package-local TypeScript strictness.
- Public exports, `EngineOptions`, hook signatures, service names, built-in tool schemas, and built-in plugin behavior are contracts; read `harness/knowledge/contracts.md` before changing them.
- Preserve `.pulse-coder/*` paths and legacy `.coder/*` compatibility unless there is an explicit migration plan.
- The public surface lives in TWO barrels: `src/index.ts` and `src/built-in/index.ts` (`./built-in` is wider). Export changes must consider both — remote-server and canvas import `./built-in` directly.
- `tsconfig.json` has no `rootDir` on purpose: the agent-teams built-in imports orchestrator source through the root paths alias, and re-adding `rootDir` breaks `typecheck` with TS6059.
- Durable engine guidance changes should update this file or the local `harness/` files instead of adding parallel notes.

## Common Commands

```bash
pnpm --filter pulse-coder-engine test
pnpm --filter pulse-coder-engine typecheck
pnpm --filter pulse-coder-engine build
pnpm --filter pulse-coder-cli test
pnpm --filter @pulse-coder/remote-server build
```

Default checks are `test` and `typecheck`. Use `build` for public exports or package configuration changes. Cross-consumer checks are selected from the root impact overlay when public API, built-in plugin, runtime-loop, or tool contracts change. Docs-only changes only need referenced path/command checks per `harness/validate/README.md`.

## Key Files

- `src/index.ts`: public exports, including the `PulseAgent` alias and built-in plugin/type exports.
- `src/Engine.ts`: engine bootstrap, provider/model option resolution, plugin/tool merge order, compaction helper, and plan-mode service helpers.
- `src/core/loop.ts`: streaming loop, LLM/tool hooks, retries/backoff, abort handling, timeout handling, tool results, and context compaction.
- `src/plugin/`: plugin manager, hook map, service/config APIs, dependency ordering, and user config plugin loading.
- `src/built-in/index.ts`: built-in plugin registration order and public built-in plugin exports.
- `src/tools/index.ts`: built-in tool registry for file, shell, Tavily, image generation, clarification, and deferred demo tools.
- `harness/knowledge/`, `harness/validate/`: package contract, architecture, and validation source of truth.

## Failure Capture

- Engine-origin failures and their guards are recorded in root `AGENTS.md` §6 (history over-pruning, execSync freezing the Electron host, UTF-8 chunk-split corruption); regression tests live in `src/core/loop.test.ts`.
- Known open risk: `src/tools/grep.ts` still uses blocking `execSync` — see `harness/knowledge/architecture.md` Risk Areas before touching tools.
