# AGENTS.md - apps/remote-server

> Local entry for `apps/remote-server`.
> Repository harness entry: `../../harness/README.md`.
> Claude Code specific local guidance also exists in `CLAUDE.md`.

## Module Positioning

`@pulse-coder/remote-server` is the optional HTTP runtime around `pulse-coder-engine`. It owns platform webhook ingress, internal automation routes, adapter streaming, shared engine/plugin wiring, remote session persistence, memory/worktree/vault context, Discord gateway startup, and local devtools observability.

Default mounted surface is defined in `src/server.ts`: `/health`, Feishu and Discord webhooks, `/internal/*`, `/api/devtools/*`, and static `/devtools/*`. Telegram and the generic Web chat/SSE API have source files but are not mounted by default.

## Progressive Reading Path

| Task | Read |
|---|---|
| Repository and harness context | `../../AGENTS.md`, `../../harness/README.md`, `../../harness/validate/validation.yaml` |
| Local runtime overview | `README.md`, `CLAUDE.md`, `docs/runbook.md`, `docs/validation.md`, `harness/validate/validation.yaml` |
| Package scripts and build shape | `package.json`, `tsup.config.ts`, `tsconfig.json` |
| Bootstrap and mounted routes | `src/index.ts`, `src/server.ts` |
| Webhook lifecycle | `src/core/dispatcher.ts`, `src/core/types.ts`, `src/core/active-run-store.ts`, `src/core/clarification-queue.ts` |
| Agent execution and run context | `src/core/agent-runner.ts`, `src/core/engine-singleton.ts` |
| Persistence and integrations | `src/core/session-store.ts`, `src/core/memory-integration.ts`, `src/core/worktree/integration.ts`, `src/core/vault/integration.ts`, `src/core/devtools.ts` |
| Slash commands | `src/core/chat-commands.ts`, `src/core/chat-commands/command-defs.ts`, `src/core/chat-commands/handlers/*` |
| Internal automation | `src/routes/internal.ts` |
| Platform behavior | `src/adapters/feishu/*`, `src/adapters/discord/*`, `src/routes/feishu.ts`, `src/routes/discord.ts` |
| Devtools API | `src/routes/devtools.ts`; static UI is built outside this workspace in `../devtools-web` |
| Focused helper tests | `src/core/model-config.test.ts`, `src/core/attachments.test.ts`, `src/core/tools/analyze-image.test.ts` |

## Local Constraints

- Keep route handlers thin; delegate lifecycle work to dispatcher, runner, adapter, or service modules.
- Do not bypass platform signature verification, loopback checks, bearer-token checks, or the per-`platformKey` active-run guard.
- Internal routes must remain loopback-only and protected by `INTERNAL_API_SECRET` in production.
- Stream user-visible output only through adapter `StreamHandle` callbacks; adapters own platform send/edit behavior.
- Keep mounted routes in `src/server.ts` and documented endpoints in sync. If a source route remains commented out, document it as implemented-but-not-mounted.
- Session, memory, worktree, vault, and devtools state live under user-level `~/.pulse-coder/*` paths. Do not treat `.pulse-coder/` repository config as harness source of truth.
- Runtime/API behavior changes should update `README.md`, `docs/runbook.md`, or validation docs when they change operator expectations.
- Never commit secrets or local runtime state.

## Common Commands

Run from the repository root unless noted.

```bash
pnpm --filter @pulse-coder/remote-server dev
pnpm --filter @pulse-coder/remote-server build
pnpm --filter @pulse-coder/remote-server start
```

`start` runs `dist/index.cjs`, so build first after source changes. PM2 helpers in `package.json` are operational commands, not default validation.

For docs-only changes, no build is required; check referenced paths and command names instead. The package currently has no workspace-local `test` script. There are Vitest files under `src/`, but the ad hoc root-level targeted run is not a clean default check until existing helper-test failures are fixed.

## Validation Notes

- Default code check: `pnpm --filter @pulse-coder/remote-server build`.
- Runtime smoke, when changing routes/dispatcher/runner/adapters and credentials are available: start `dev`, then call `/health`; for internal automation, also smoke `/internal/agent/run` from loopback with `INTERNAL_API_SECRET`.
- Escalate to engine, memory-plugin, plugin-kit, ACP, or langfuse checks when changes cross those integration boundaries.

## Key Files

- `src/index.ts`: initializes session, memory, worktree, vault, devtools, engine, Discord gateway, app server, and Discord commands.
- `src/server.ts`: Hono app factory and the source of truth for mounted HTTP routes.
- `src/core/dispatcher.ts`: signature-verified webhook flow, fast ack, slash-command handling, active-run guard, and streaming callbacks.
- `src/core/agent-runner.ts`: session lookup, attachment context, model override resolution, ACP fallback, engine run, compaction capture, and memory logging.
- `src/core/engine-singleton.ts`: shared engine plugins and remote custom tools.
- `src/routes/internal.ts`: loopback-only automation and Discord gateway internal endpoints.
- `src/routes/devtools.ts`: local devtools JSON API consumed by the optional `../devtools-web` UI.
