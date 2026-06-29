# AGENTS.md - packages/orchestrator

> Local entry for `packages/orchestrator`.
> Repository harness entry: `../../harness/README.md`.

## Module Positioning

`pulse-coder-orchestrator` owns the generic multi-agent orchestration layer: task graph modeling, routing, planning, scheduling, running, artifact storage, and aggregation.

It should remain lower-level than `packages/agent-teams` and keep the core package free of engine coupling. The orchestrator executes through the `AgentRunner` interface; `EngineAgentRunner` is only an adapter for engine tool registries.

Team UX, review gates, checkpoints, human handoffs, and host session policy belong in `packages/agent-teams` or host apps unless they are generic orchestration primitives.

## Knowledge Navigation

| Task | Read |
|---|---|
| Package overview | `README.md` |
| Architecture plan | `../../docs/05-orchestrator-plan.md` |
| Public exports | `src/index.ts` |
| Public types and inputs | `src/types.ts` |
| Top-level run flow | `src/orchestrator.ts` |
| Task graph validation/building | `src/graph.ts` |
| Role routing | `src/router.ts` |
| LLM graph planning | `src/planner.ts` |
| DAG scheduling and retries | `src/scheduler.ts` |
| Execution boundary and logging | `src/runner.ts` |
| Artifact persistence | `src/artifact-store.ts` |
| Result aggregation | `src/aggregator.ts` |
| Engine tool adapter | `src/adapters/engine-agent-runner.ts` |
| Package scripts | `package.json` |

## Local Constraints

- Keep orchestration primitives generic and host-agnostic.
- Avoid mixing team-specific review/checkpoint policy into generic graph execution.
- Preserve deterministic DAG semantics for dependency readiness, optional-node skipping, retry handling, and blocked dependents.
- Keep `runner.ts` as the execution boundary. New execution backends should implement `AgentRunner` instead of importing engine/runtime host code into the core flow.
- `route="plan"` and `aggregate="llm"` require an injected `llmCall`; do not add hidden model/provider dependencies.
- The default `LocalArtifactStore` writes under `.pulse-coder/agent-teams`; be careful not to treat these runtime artifacts as repository source of truth.
- Route public contract changes through `harness/skills/contract-coding.md`.

## Common Commands

```bash
pnpm --filter pulse-coder-orchestrator test
pnpm --filter pulse-coder-orchestrator typecheck
pnpm --filter pulse-coder-orchestrator build
```

`test` is executable but currently uses `--passWithNoTests`; add nearby specs before relying on it as behavioral coverage for scheduler, graph, planner, or aggregation changes.

## Key Files

- `src/orchestrator.ts`: run orchestration, route selection, graph validation, scheduling, and aggregation.
- `src/types.ts`: public task graph, node result, input, and result contracts.
- `src/scheduler.ts`: concurrent DAG execution, dependency readiness, optional failures, retries, timeouts, upstream context, and artifact writes.
- `src/graph.ts`: static graph builder and dependency validation.
- `src/planner.ts`: LLM-produced TaskGraph parsing and validation.
- `src/router.ts`: keyword role routing.
- `src/aggregator.ts`: concat, last-success, and LLM summary aggregation.
- `src/artifact-store.ts`: artifact write/cleanup interface and local implementation.
- `src/runner.ts`: `AgentRunner` and logger contracts.
- `src/adapters/engine-agent-runner.ts`: adapter to `pulse-coder-engine`.
