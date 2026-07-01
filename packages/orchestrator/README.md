# pulse-coder-orchestrator

Multi-agent orchestration layer for Pulse Coder. Builds a dependency-aware **TaskGraph**, schedules nodes across agents in parallel, and aggregates results. This package has **zero engine dependency** — it defines an `AgentRunner` interface so any execution backend can be plugged in.

For the broader design (decoupling from engine, CLI/remote-server/canvas-workspace integration, session lifecycle roadmap) see [`docs/05-orchestrator-plan.md`](../../docs/05-orchestrator-plan.md).

## Architecture

```
Orchestrator.run(input)
 ├── 1. Route roles    → auto (keyword) / all / plan (LLM)
 ├── 2. Build graph    → caller-supplied graph, static template, or LLM-planned TaskGraph
 ├── 3. Validate       → check duplicate node IDs and missing-dependency references
 ├── 4. Schedule       → run nodes in parallel respecting deps + concurrency
 └── 5. Aggregate      → concat / last / llm
```

Note: step 3 does **not** detect cycles. `validateTaskGraph` only flags duplicate IDs and deps that reference non-existent nodes. A cyclic graph surfaces at runtime when the scheduler finds no runnable node (`'No runnable nodes; check DAG for cycles'`).

### Pipeline

| Step | Module | Description |
|------|--------|-------------|
| Route | `router.ts` | Keyword-based role selection from task text |
| Plan | `planner.ts` | LLM-generated TaskGraph with per-node sub-task descriptions |
| Graph | `graph.ts` | Static graph builder (researcher → executor → reviewer/writer/tester) |
| Schedule | `scheduler.ts` | Concurrent DAG executor with retry, timeout, and optional-node skipping |
| Aggregate | `aggregator.ts` | Merge results via concatenation, last-success, or LLM synthesis |

### Built-in Roles

`researcher`, `executor`, `reviewer`, `writer`, `tester` — plus any custom `string` role.

### Routing Strategies

| `route` | Behavior |
|---------|----------|
| `'auto'` | Keyword matching — always includes researcher + executor; adds reviewer/writer/tester if task text matches patterns |
| `'all'` | Every registered role participates |
| `'plan'` (default) | LLM dynamically builds the TaskGraph from available roles |

## Usage

```typescript
import { Orchestrator } from 'pulse-coder-orchestrator';

const orchestrator = new Orchestrator({
  runner: myAgentRunner,       // implements AgentRunner interface
  llmCall: myLlmCallFn,        // required for route='plan'; aggregate='llm' falls back to concat without it
});

const result = await orchestrator.run({
  task: 'Review the auth module for security issues',
  route: 'auto',
  maxConcurrency: 3,
  retries: 1,
  aggregate: 'concat',
});

console.log(result.aggregate);  // merged output from all agents
console.log(result.results);    // per-node NodeResult map
```

> **Defaults caveat.** The default `route` is `'plan'` and the default `aggregate` is `'llm'` (see Configuration). A bare `orchestrator.run({ task })` therefore throws `'llmCall is required for route="plan"'` unless an `llmCall` is injected. To run without an LLM, set `route: 'auto'` (or `'all'`) explicitly.

### AgentRunner Interface

```typescript
interface AgentRunner {
  run(input: { agentName: string; task: string; context?: Record<string, any> }): Promise<string>;
  getAvailableAgents(): string[];
}
```

The included `EngineAgentRunner` adapter bridges engine tools to this interface:

```typescript
import { EngineAgentRunner } from 'pulse-coder-orchestrator';

const runner = new EngineAgentRunner(() => engine.getTools());
```

### TaskGraph

```typescript
interface TaskGraph {
  nodes: TaskNode[];
}

interface TaskNode {
  id: string;
  role: TeamRole;
  deps: string[];          // node IDs that must complete first
  input?: string;          // sub-task description
  optional?: boolean;      // failure doesn't block dependents
  agent?: string;          // override agent name (default: roleAgents mapping)
  instruction?: string;    // prepended to the task prompt
}
```

## Configuration / Options

### `OrchestratorOptions` (constructor)

| Option | Type | Default | Notes |
|--------|------|---------|-------|
| `runner` | `AgentRunner` | — (required) | Execution backend |
| `artifactStore` | `ArtifactStore` | `new LocalArtifactStore()` | Persistence is **default-on**; inject a custom store (e.g. a no-op) to change this |
| `logger` | `OrchestratorLogger` | `defaultLogger` | Console logger with `[Orchestrator]` prefix; `debug` is a no-op |
| `defaultRoleAgents` | `Record<string, string>` | see below | Override the built-in role → agent name mapping |
| `llmCall` | `(system, user) => Promise<string>` | `undefined` | Required for `route='plan'`; used by `aggregate='llm'` when present |

Built-in `defaultRoleAgents`: `researcher → researcher_agent`, `executor → executor_agent`, `reviewer → reviewer_agent`, `writer → writer_agent`, `tester → tester_agent`.

### `OrchestrationInput` (per run)

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `task` | `string` | — (required) | The task text |
| `context` | `Record<string, any>` | `undefined` | Passed to each node as `runContext` |
| `roles` | `TeamRole[]` | derived from `route` | Explicit role list; overrides routing when set |
| `graph` | `TaskGraph` | `undefined` | Caller-supplied graph; used as-is for execution (skips planning and the static `buildTaskGraph`, but routing still runs to populate `roles` in the result) |
| `route` | `'auto' \| 'all' \| 'plan'` | `'plan'` | Role selection strategy |
| `includeRoles` | `TeamRole[]` | `undefined` | Added to the routed role set |
| `excludeRoles` | `TeamRole[]` | `undefined` | Removed from the routed role set |
| `roleAgents` | `Record<string, string>` | constructor default | Per-run role → agent overrides |
| `maxConcurrency` | `number` | `3` | Max nodes executing in parallel |
| `nodeTimeoutMs` | `number` | `600000` (10 min) | Per-node execution timeout |
| `retries` | `number` | `1` | Extra attempts after the first failure |
| `aggregate` | `'concat' \| 'last' \| 'llm'` | `'llm'` | Result merge strategy; `'llm'` degrades to `'concat'` when no `llmCall` is provided |

### ArtifactStore

Results are persisted by default. The `Orchestrator` always constructs a `LocalArtifactStore` unless one is injected, and the scheduler writes each successful node's output. The default `LocalArtifactStore` writes to `.pulse-coder/agent-teams/{runId}/{nodeId}.md`.

```typescript
export interface ArtifactStore {
  write(runId: string, nodeId: string, role: string, content: string): Promise<string>;
  getPath(runId: string, nodeId: string): string;
  cleanup(runId: string): Promise<void>;
}
```

## Exports / API

Beyond `Orchestrator` and `EngineAgentRunner`, `src/index.ts` re-exports the lower-level building blocks so callers can compose pipelines directly.

**Classes / values**

| Export | Kind | Description |
|--------|------|-------------|
| `Orchestrator` | class | Top-level run orchestrator |
| `EngineAgentRunner` | class | Adapter from engine tool registries to `AgentRunner` |
| `LocalArtifactStore` | class | Filesystem-backed `ArtifactStore` |
| `defaultLogger` | value | Console `OrchestratorLogger` |

**Functions**

| Export | Description |
|--------|-------------|
| `buildTaskGraph({ task, roles })` | Build the static template graph |
| `validateTaskGraph(graph)` | Check duplicate node IDs and missing deps; returns `{ valid, errors }`. Does **not** detect cycles. |
| `routeRoles(task, availableRoles)` | Keyword-based role routing |
| `planTaskGraph({ task, availableRoles, llmCall })` | LLM-produced TaskGraph (parses JSON, throws on invalid output) |
| `aggregateResults(results, strategy?, _llmCall?)` | **Sync**; always concatenates regardless of `strategy` — use `aggregateResultsAsync` for `'last'` / `'llm'` |
| `aggregateResultsAsync(results, strategy?, llmCall?)` | Async concat / last-success / LLM synthesis |

**Types**

`OrchestratorOptions`, `OrchestrationInput`, `OrchestrationResult`, `TaskGraph`, `TaskNode`, `NodeResult`, `TeamRole`, `TaskNodeStatus`, `AggregateStrategy`, `AgentRunner`, `AgentRunInput`, `OrchestratorLogger`, `ArtifactStore`.

## Build & Test

```bash
pnpm --filter pulse-coder-orchestrator build
pnpm --filter pulse-coder-orchestrator typecheck
pnpm --filter pulse-coder-orchestrator test
```

> **Testing reality.** This package currently has **zero test files** under `src/`. The `test` script is `vitest run --passWithNoTests`, so it exits green without running anything — a green `test` is **not** behavioral coverage. Add specs alongside scheduler, graph, planner, or aggregation changes before relying on it.
