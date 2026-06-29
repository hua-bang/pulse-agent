# Remote Server Validation

Run commands from the repository root.

## Default Check

```bash
pnpm --filter @pulse-coder/remote-server build
```

The build runs package prebuild dependencies and compiles the server with `tsup`.

## Runtime Smoke

When routes, dispatcher, agent runner, adapter streaming, or internal automation behavior changes, run a local smoke if credentials and environment are available:

```bash
pnpm --filter @pulse-coder/remote-server dev
curl http://127.0.0.1:<port>/health
```

For internal automation changes, also test `/internal/agent/run` with loopback and `INTERNAL_API_SECRET`; see `docs/runbook.md`.

## Escalation

If engine integration, model config, memory integration, or worktree binding changes, include affected package checks when practical:

```bash
pnpm --filter pulse-coder-engine test
pnpm --filter pulse-coder-memory-plugin test
pnpm --filter pulse-coder-plugin-kit test
```

If platform adapter behavior changes, include manual platform evidence or explicitly state why it was not run.

## Docs-only Changes

If only `AGENTS.md`, `CLAUDE.md`, `docs/runbook.md`, or `docs/validation.md` changed, no build is required. Check referenced paths and commands instead.
