# AGENTS.md - packages/engine

> Local entry for `packages/engine`.
> Repository harness entry: `../../harness/README.md`.

## Module Positioning

`pulse-coder-engine` owns the reusable agent runtime: engine initialization, tool execution loop, hooks, built-in plugins, tool registration, and context management.

It should stay host-agnostic. CLI, remote server, and canvas-specific behavior should integrate through options, plugins, hooks, or services rather than being hardcoded into the engine loop.

## Knowledge Navigation

| Task | Read |
|---|---|
| Understand public contracts | `docs/contracts.md` |
| Pick validation | `docs/validation.md` |
| Engine bootstrap | `src/Engine.ts` |
| Execution loop | `src/core/loop.ts` |
| Built-in plugin list | `src/built-in/index.ts` |
| Built-in tools | `src/tools/` |
| Plugin APIs | `src/plugin/` |

## Local Constraints

- Prefer plugin, hook, tool, or service extension points over engine-loop hardcoding.
- Keep source imports ESM-style and follow package-local TypeScript strictness.
- Public exports and tool schemas are contracts; route changes through `harness/skills/contract-coding.md`.
- Runtime feedback that changes engine guidance should route through `harness/skills/feedback-governance.md`.

## Common Commands

```bash
pnpm --filter pulse-coder-engine test
pnpm --filter pulse-coder-engine typecheck
pnpm --filter pulse-coder-engine build
```

## Key Files

- `src/Engine.ts`: engine bootstrap and plugin/tool merge order.
- `src/core/loop.ts`: execution loop, streaming, retries, hooks, abort, compaction.
- `src/built-in/index.ts`: built-in plugin registration.
- `src/tools/`: built-in tool definitions.
- `src/plugin/`: plugin manager and context APIs.
