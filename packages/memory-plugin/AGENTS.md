# AGENTS.md - packages/memory-plugin

> Local entry for `packages/memory-plugin`.
> Repository harness entry: `../../harness/README.md`.

## Module Positioning

`pulse-coder-memory-plugin` owns host-side memory service integration for Pulse Coder runtimes. It provides memory service models, recall/write behavior, daily logs, embeddings, state storage, and integration helpers.

Memory behavior should preserve the boundary between user memory, project/repository knowledge, and runtime session logs.

## Knowledge Navigation

| Task | Read |
|---|---|
| Package overview | `README.md` |
| Product/technical docs | `../../docs/memory-plugin/` |
| Public exports | `src/index.ts` |
| Integration API | `src/integration.ts` |
| Service behavior | `src/service.ts`, `src/service/` |
| Types | `src/types.ts` |
| Embeddings | `src/embedding/` |
| State/logs | `src/service/state-store.ts`, `src/service/daily-log.ts` |

## Local Constraints

- Do not treat non-versioned runtime memory as repository SSOT.
- Keep secret/API-key handling environment-based and out of committed files.
- Changes to recall/write behavior should include tests or explicit manual evidence.
- Feedback about repository rules should route through `harness/skills/feedback-governance.md`, not silently into memory.

## Common Commands

```bash
pnpm --filter pulse-coder-memory-plugin test
pnpm --filter pulse-coder-memory-plugin typecheck
pnpm --filter pulse-coder-memory-plugin build
```

## Key Files

- `src/index.ts`: public package entry.
- `src/integration.ts`: host integration helpers.
- `src/service.ts` and `src/service/`: memory service implementation.
- `src/embedding/`: embedding providers and vector storage.
- `src/types.ts`: public types.
