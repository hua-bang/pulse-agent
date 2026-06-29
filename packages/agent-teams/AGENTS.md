# AGENTS.md - packages/agent-teams

> Local entry for `packages/agent-teams`.
> Repository harness entry: `../../harness/README.md`.

## Module Positioning

`pulse-coder-agent-teams` owns multi-session team coordination above the engine and below host experiences such as `apps/teams-cli` and `apps/canvas-workspace`.

The package currently exposes two surfaces:

- Classic in-process coordination: `Team`, `TeamLead`, `Teammate`, `TaskList`, `Mailbox`, the LLM planner, and terminal display helpers.
- Protocol runtime coordination: `src/runtime/` records teams, agents, tasks, artifacts, human gates, mailbox messages, session events, review gates, round checkpoints, scope controls, verify metadata, and handoff paths for host-driven teams.

It should keep team protocol behavior explicit and avoid hiding quality gates in prompts alone.

## Knowledge Navigation

| Task | Read |
|---|---|
| Package overview and classic API | `README.md` |
| Understand contracts | `docs/contracts.md` |
| Pick validation | `docs/validation.md` |
| Maturity roadmap | `../../docs/07-agent-teams-maturity-roadmap.md` |
| Runtime exports | `src/runtime.ts`, `src/runtime/index.ts` |
| Runtime implementation | `src/runtime/team-runtime.ts`, `src/runtime/types.ts` |
| Runtime store and DAG checks | `src/runtime/memory-store.ts`, `src/runtime/task-graph.ts` |
| Classic team API | `src/team.ts`, `src/team-lead.ts`, `src/teammate.ts` |
| Classic task and mailbox state | `src/task-list.ts`, `src/mailbox.ts` |
| Planner and display | `src/planner.ts`, `src/display/in-process.ts` |
| Tests | `src/__tests__/`, `src/runtime/__tests__/team-runtime.test.ts` |
| Package scripts | `package.json` |

## Local Constraints

- Team completion should mean deliverable evidence, not only an agent claim.
- Verify commands, handoff material, review state, dependency blocking, round checkpoints, and human gates are protocol-level concerns.
- The Team Lead coordinates and verifies; teammate task execution, ownership changes, scope edits, and revision loops must stay explicit in runtime state.
- `TASK_METADATA_KEYS` is shared with hosts. Changes to `round`, `scope`, `verify`, `lastVerify`, or failed-dependency metadata affect consumers.
- Classic `Team/TeamLead` state is file-backed under the configured team state directory. Runtime state is store-backed and host adapters own actual process/session behavior.
- Public runtime exports are contracts; route changes through `harness/skills/contract-coding.md`.
- Host-specific UI, PTY, or Canvas behavior belongs in host apps, not this package, unless it is a generic team protocol primitive.

## Common Commands

```bash
pnpm --filter pulse-coder-agent-teams test
pnpm --filter pulse-coder-agent-teams typecheck
pnpm --filter pulse-coder-agent-teams build
```

Docs-only changes can use the harness docs rule: check referenced paths and commands instead of running package build/test.

## Key Files

- `src/index.ts`: classic public exports.
- `src/runtime.ts` and `src/runtime/index.ts`: runtime public exports.
- `src/runtime/team-runtime.ts`: protocol runtime lifecycle, dispatch, review, checkpoints, scopes, verification evidence, handoffs, gates, artifacts, and lead notifications.
- `src/runtime/types.ts`: runtime records, statuses, adapter/store contracts, events, metadata, and verification result shapes.
- `src/runtime/memory-store.ts`: in-memory runtime store used by tests and lightweight hosts.
- `src/runtime/task-graph.ts`: dependency-cycle checks and topological round helpers.
- `src/team.ts`, `src/team-lead.ts`, `src/teammate.ts`: classic in-process team orchestration.
- `src/task-list.ts`, `src/mailbox.ts`: classic file-backed task queue and mailbox.
- `src/__tests__/` and `src/runtime/__tests__/team-runtime.test.ts`: behavioral coverage for classic and runtime flows.
- `package.json`: package scripts and runtime dependencies.
