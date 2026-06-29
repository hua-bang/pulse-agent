# AGENTS.md - apps/remote-server

> Local entry for `apps/remote-server`.
> Repository harness entry: `../../harness/README.md`.
> Claude Code specific local guidance also exists in `CLAUDE.md`.

## Module Positioning

`@pulse-coder/remote-server` hosts the engine behind HTTP/webhook integrations. It owns webhook dispatch, platform adapters, internal automation routes, engine singleton wiring, session persistence, memory integration, and runtime operational concerns.

## Knowledge Navigation

| Task | Read |
|---|---|
| Local Claude guidance | `CLAUDE.md` |
| Operations and smoke testing | `docs/runbook.md` |
| Pick validation | `docs/validation.md` |
| Bootstrap/server | `src/index.ts`, `src/server.ts` |
| Webhook dispatch | `src/core/dispatcher.ts` |
| Agent execution | `src/core/agent-runner.ts` |
| Internal API | `src/routes/internal.ts` |
| Custom tools | `src/core/engine-singleton.ts` |

## Local Constraints

- Keep route handlers thin; delegate to dispatcher, runner, or adapter modules.
- Do not bypass platform signature verification or the active-run concurrency guard.
- Internal routes must remain loopback-only and bearer-token protected.
- Stream output through adapter `StreamHandle` callbacks; adapters own platform send behavior.
- Runtime or API contract changes should update `docs/runbook.md` or validation guidance when needed.

## Common Commands

```bash
pnpm --filter @pulse-coder/remote-server dev
pnpm --filter @pulse-coder/remote-server build
pnpm --filter @pulse-coder/remote-server start
```

## Key Files

- `src/index.ts`: bootstrap stores, memory, worktree binding, engine, gateway, and server.
- `src/server.ts`: Hono server and route mounting.
- `src/core/dispatcher.ts`: webhook ack, slash commands, concurrency, streaming dispatch.
- `src/core/agent-runner.ts`: run context, engine execution, session and memory persistence.
- `src/routes/internal.ts`: internal automation routes.
