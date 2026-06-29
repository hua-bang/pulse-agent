# AGENTS.md - packages/orchestrator

> Local entry for `packages/orchestrator`.
> Repository harness entry: `../../harness/README.md`.

## Module Positioning

`pulse-coder-orchestrator` owns the generic multi-agent orchestration layer: task graph modeling, routing, planning, scheduling, running, artifact storage, and aggregation.

It should remain lower-level than `packages/agent-teams`. Team UX, review gates, checkpoints, and handoff conventions belong in agent-teams or host apps unless they are generic orchestration primitives.

## Knowledge Navigation

| Task | Read |
|---|---|
| Package overview | `README.md` |
| Architecture plan | `../../docs/05-orchestrator-plan.md` |
| Public exports | `src/index.ts` |
| Task graph | `src/graph.ts`, `src/types.ts` |
| Routing | `src/router.ts` |
| Planning | `src/planner.ts` |
| Scheduling/running | `src/scheduler.ts`, `src/runner.ts`, `src/orchestrator.ts` |
| Engine adapter | `src/adapters/engine-agent-runner.ts` |

## Local Constraints

- Keep orchestration primitives generic and host-agnostic.
- Avoid mixing team-specific review/checkpoint policy into generic graph execution.
- Preserve deterministic DAG semantics for dependencies and scheduling.
- Route public contract changes through `harness/skills/contract-coding.md`.

## Common Commands

```bash
pnpm --filter pulse-coder-orchestrator test
pnpm --filter pulse-coder-orchestrator typecheck
pnpm --filter pulse-coder-orchestrator build
```

## Key Files

- `src/types.ts`: orchestration types and task node shapes.
- `src/graph.ts`: graph construction and dependency behavior.
- `src/orchestrator.ts`: top-level orchestration flow.
- `src/runner.ts`: agent execution abstraction.
- `src/adapters/engine-agent-runner.ts`: adapter to `pulse-coder-engine`.
