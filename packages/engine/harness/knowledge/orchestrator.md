# Orchestrator module (`src/orchestrator/`)

Formerly the standalone `packages/orchestrator` workspace; folded into the
engine because its only consumers were the engine's built-in
`agent-teams-plugin` and `packages/cli` (`/team` commands). Public API is
unchanged and exposed via the `pulse-coder-engine/orchestrator` subpath
export (built as `dist/orchestrator/index.*` from the tsup entry).

## Positioning

Generic multi-agent orchestration: task graph modeling, routing, planning,
scheduling, running, artifact storage, aggregation. It sits BELOW
`packages/agent-teams` and must stay host-agnostic:

- The module executes through the `AgentRunner` interface (`runner.ts` is
  the execution boundary). New execution backends implement `AgentRunner`;
  do not import engine runtime/host code into the core flow —
  `adapters/engine-agent-runner.ts` is the only engine-facing adapter, and
  it stays structural (no engine imports) by design.
- Team UX, review gates, checkpoints, human handoffs, and host session
  policy belong in `packages/agent-teams` or host apps unless they are
  generic orchestration primitives.

## Invariants

- Preserve deterministic DAG semantics: dependency readiness,
  optional-node skipping, retry handling, blocked dependents
  (`scheduler.ts`).
- `route="plan"` and `aggregate="llm"` require an injected `llmCall`; do
  not add hidden model/provider dependencies.
- The default `LocalArtifactStore` writes under `.pulse-coder/agent-teams`;
  these runtime artifacts are NOT repository source of truth.
- Changes to the public surface (`index.ts`, `types.ts`) are cross-package
  impact: consumers are `built-in/agent-teams-plugin` (in-repo relative
  imports + type re-exports with renames, e.g. `OrchestrationInput as
  TeamRunInput` in `built-in/index.ts`) and `packages/cli`
  (`src/commands/team-commands.ts` via the subpath export).

## Key files

- `orchestrator.ts` — run orchestration, route selection, graph validation,
  scheduling, aggregation.
- `types.ts` — public task graph, node result, input, result contracts.
- `scheduler.ts` — concurrent DAG execution, retries, timeouts, upstream
  context, artifact writes.
- `graph.ts` — static graph builder + dependency validation.
- `planner.ts` — LLM-produced TaskGraph parsing/validation.
- `router.ts` — keyword role routing.
- `aggregator.ts` — concat, last-success, LLM summary aggregation.
- `artifact-store.ts` — artifact write/cleanup interface + local impl.
- `adapters/engine-agent-runner.ts` — adapter to engine tool registries.

## Test reality

The module arrived with ZERO specs (the old package ran
`--passWithNoTests`). Scheduler/graph/planner/aggregator changes need
nearby specs added before a green run counts as behavioral coverage.
