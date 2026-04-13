# pulse-coder-orchestrator

Multi-agent orchestration layer for Pulse Coder. Builds a dependency-aware **TaskGraph**, schedules nodes across agents in parallel, and aggregates results. This package has **zero engine dependency** — it defines an `AgentRunner` interface so any execution backend can be plugged in.

## Architecture

```
Orchestrator.run(input)
 ├── 1. Route roles    → auto (keyword) / all / plan (LLM)
 ├── 2. Build graph    → static template or LLM-planned TaskGraph
 ├── 3. Validate       → check IDs, deps, cycles
 ├── 4. Schedule       → run nodes in parallel respecting deps + concurrency
 └── 5. Aggregate      → concat / last / llm
```

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
  llmCall: myLlmCallFn,       // required for route='plan' and aggregate='llm'
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

### ArtifactStore

Results are optionally persisted via `ArtifactStore`. The default `LocalArtifactStore` writes to `.pulse-coder/agent-teams/{runId}/{nodeId}.md`.

## Build & Test

```bash
pnpm --filter pulse-coder-orchestrator build
pnpm --filter pulse-coder-orchestrator test
pnpm --filter pulse-coder-orchestrator typecheck
```
