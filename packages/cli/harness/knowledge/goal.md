# Goal-driven continuation (`/goal`)

## Architecture

The goal state machine lives in **plugin-kit** (`packages/plugin-kit/src/goal/runner.ts`,
`runGoalLoop`). The CLI is a thin IO-injecting host — it never owns goal policy.

| Layer | Responsibility | Where |
|---|---|---|
| Store | `FileGoalPluginService`, file-backed per-session goal | plugin-kit `src/goal/service.ts` |
| Plugin | `goal_set/status/clear/complete` tools; prompt-FREE by design | plugin-kit `src/goal/integration.ts` |
| Message builders | Codex-style USER messages (never system) | plugin-kit `buildGoalContinuationMessage` / `buildGoalObjectiveUpdatedMessage` |
| State machine | auto-continue, verify, user-confirm gate, maxRounds, re-arm | plugin-kit `src/goal/runner.ts` |
| Host IO | `runOnce` (one agent round), `confirm`, `verify` | CLI `src/ink/controller-run.ts` (`startGoalLoop`), `controller-goal.ts` |

## Cache safety (why goal never touches the system prompt)

Anthropic `cacheControl` and OpenAI-compatible auto-cache match the request
prefix from byte 0. The system prompt is that prefix. If goal state (rounds,
progress, even the objective) rode the system prompt, every change would miss
the whole cache — and per-round dynamic state would miss on EVERY continuation
round. Codex avoids this by injecting goal steering as `ContextualUserFragment`
(role `user`). We mirror that: `buildGoalContinuationMessage` produces a user
message, and the plugin registers NO system-prompt hooks. Setting/clearing a
goal costs ZERO cache misses.

## Budgets

Two independent budgets guard a goal run:
- engine `MAX_STEPS` (per-round tool-call cap, inside one `agent.run`)
- goal `maxRounds` (host-side continuation rounds, enforced by `runGoalLoop`)

## Completion gate

Model completion (`goal_complete`) is NEVER auto-accepted:
1. Optional `--verify <cmd>` runs first (the user's own command, shell-executed
   — equivalent to them typing it). Failure re-arms the goal and feeds the
   failure output back as `Last progress`.
2. User confirmation via `inputManager.requestInput` (kind `approval`,
   default `y`). `stop`/`clear` ends; any other answer continues with that
   text as user feedback.

## Trigger points

- `runMessage`: after the user's own round, if goal is active/completed →
  `startGoalLoop`.
- `/goal <objective>`: auto-starts the first round (Codex's `continue_if_idle`)
  via `runExclusive`.

## Scope binding

`syncSessionGoalBinding` (after create/resume, both interactive hosts) switches
the SAME service instance via `setScope` — mirroring `TaskListService.setTaskListId`.
Never rebuild the integration for a scope switch; the engine plugin holds the
original instance. Scope names are file names: dots excluded on purpose to keep
`..` out of the storage path.

## Readline caveat

The readline host has `/goal` commands and scope binding but NO continuation
loop (`startGoalLoop` is Ink-only today). Intentional scope boundary, not an
accident.
