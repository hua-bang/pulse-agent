# pulse-coder-agent-teams

Multi-session collaborative agent coordination layer for Pulse Coder. Each teammate gets its own independent `Engine` instance (and thus its own context window, model, and toolset) while sharing a common task queue and mailbox.

The package exposes two coordination surfaces (see `AGENTS.md`):

- **Classic in-process coordination** — `Team` / `TeamLead` / `Teammate` / `TaskList` / `Mailbox`, an LLM planner, and a terminal display helper. The package owns the `Engine` instances and the execution loop. Documented below in *Architecture* through *Plan Approval*.
- **Protocol runtime coordination** — `TeamRuntime` (the `./runtime` entrypoint), a host-driven runtime that holds team/agent/task/artifact/gate state in a store and drives external agent sessions through an adapter, with explicit review gates, round checkpoints, and verification evidence. Documented in *Protocol Runtime (`./runtime`)*.

## Architecture (classic surface)

```
TeamLead
 └── Team
      ├── Mailbox         # inter-agent message passing
      ├── TaskList        # shared task queue with dependency tracking
      └── Teammate[]      # independent Engine instances
```

### Core Classes

| Class | Description |
|-------|-------------|
| `Team` | Lifecycle manager — spawns teammates, owns the TaskList and Mailbox, drives the execution loop |
| `TeamLead` | High-level orchestrator — adds LLM-driven planning, result synthesis, and follow-up flows |
| `Teammate` | Wraps a single `Engine` instance; claims tasks, executes them, communicates via mailbox |
| `TaskList` | Shared file-backed task queue with dependency resolution and work-stealing guard |
| `Mailbox` | Typed message bus (`message`, `broadcast`, `shutdown_request`, `plan_approval_request`, …) |

State is persisted to `~/.pulse-coder/teams/<name>/` (configurable via `TeamConfig.stateDir`).

## Installation

```bash
pnpm add pulse-coder-agent-teams
```

## Usage

### Option A — Automated (`TeamLead.orchestrate`)

The simplest path: give a goal string and `TeamLead` handles planning, spawning, execution, and synthesis.

```typescript
import { TeamLead } from 'pulse-coder-agent-teams';

const lead = new TeamLead({
  teamName: 'my-team',
  cwd: '/path/to/project',
});
await lead.initialize();

const { plan, results, synthesis } = await lead.orchestrate(
  'Audit the codebase for security vulnerabilities and propose fixes',
  {
    // Optional: inspect and approve the plan before execution
    onPlan: async (plan) => {
      console.log('Plan:', plan);
      return true; // return false to abort
    },
    timeoutMs: 20 * 60 * 1000, // 20 min
    concurrency: 3,             // max teammates running at once
  },
);

console.log(synthesis);
await lead.team.cleanup();
```

`orchestrate` runs five phases internally:
1. **Plan** — LLM decomposes the goal into teammates and tasks
2. **Spawn** — creates one `Engine` per planned teammate
3. **Create tasks** — populates the shared `TaskList` with dependency edges
4. **Run** — teammates claim and execute tasks in parallel
5. **Synthesize** — lead summarises all results into a final response

### Option B — Manual (`Team` directly)

Use `Team` directly when you want full control over teammates and tasks.

```typescript
import { Team } from 'pulse-coder-agent-teams';

const team = new Team({ name: 'my-team', cwd: '/path/to/project' });

// Spawn teammates (each gets its own Engine)
await team.spawnTeammates([
  { id: 'researcher', name: 'researcher', spawnPrompt: 'You are a researcher.' },
  { id: 'writer',     name: 'writer',     spawnPrompt: 'You are a technical writer.' },
]);

// Create tasks with optional dependency edges
await team.createTasks([
  { title: 'Research topic', description: 'Investigate X thoroughly.' },
  { title: 'Write summary',  description: 'Summarise findings.', deps: ['<research-task-id>'] },
]);

// Run — teammates claim tasks in parallel until all are done
const { results, stats } = await team.run({ timeoutMs: 10 * 60 * 1000 });
console.log(stats); // { total, pending, in_progress, completed, failed }

await team.cleanup();
```

### Follow-up Turns

After `orchestrate`, call `followUp` to add more work to the same team without re-spawning existing teammates.

```typescript
const { synthesis } = await lead.followUp(
  'Now write integration tests for the fixes that were identified',
);
```

## Task Model

```typescript
interface Task {
  id: string;
  title: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  deps: string[];        // IDs of tasks that must complete first
  assignee: string | null;
  createdBy: string;
  createdAt: number;     // ms epoch, set on creation
  updatedAt: number;     // ms epoch, updated on every status change
  result?: string;       // populated on completion
}
```

Tasks without pending deps are immediately claimable. When a task completes its result is automatically injected as context into dependent tasks.

## Teammate Tools

Every teammate is automatically equipped with team-aware tools (7 by default; `team_submit_plan` is added when `requirePlanApproval: true`):

| Tool | Description |
|------|-------------|
| `team_send_message` | Send a message to a specific teammate by ID |
| `team_read_messages` | Read unread messages from the team mailbox |
| `team_list_tasks` | List all tasks with their status and assignee |
| `team_claim_task` | Claim a pending task — specific ID, or auto-claim the next available one |
| `team_complete_task` | Mark a task as completed with an optional result summary |
| `team_create_task` | Create a new task in the shared task list |
| `team_notify_lead` | Send a message to the team lead |
| `team_submit_plan` | _(plan mode only)_ Submit a plan to the lead for approval before executing |

If a teammate finishes its `Engine.run()` without calling `team_complete_task`, the task is auto-completed with the run output.

## Hooks

```typescript
const team = new Team(config, {
  onTeammateIdle: async (id, name) => {
    // Return a string to keep the teammate working, or undefined to let it stop
    return undefined;
  },
  onTaskCreated: async (task) => {
    // Return a string to block creation with feedback, or undefined to allow
    return undefined;
  },
  onTaskCompleted: async (task) => {
    // Return a string to reject the completion, or undefined to accept
    return undefined;
  },
});
```

## Events

Subscribe to team events with `team.on(handler)`:

```typescript
const off = team.on((event) => {
  console.log(event.type, event.data);
});
// Later: off() to unsubscribe
```

Events emitted by the classic `Team`/`TeamLead`: `teammate:spawned`, `teammate:idle`, `teammate:stopped`, `teammate:status`, `teammate:output`, `teammate:run_start`, `teammate:run_end`, `task:created`, `task:claimed`, `task:completed`, `task:failed`, `team:phase`, `team:started`, `team:completed`, `team:cleanup`.

> Note: `message:sent` and `message:received` are declared in the `TeamEventType` union (`src/types.ts`) but are **not emitted** by the classic `Team`/`TeamLead`/`Teammate`/`Mailbox` surface. Do not rely on them firing.

## Plan Approval

Set `requirePlanApproval: true` on a `TeammateOptions` to put that teammate in plan mode. The teammate submits its plan via `team_submit_plan` (a `plan_approval_request` mailbox message) before executing; the lead (or a hook) sends a `plan_approval_response` to approve or reject with feedback.

## Public Exports (root entrypoint)

`src/index.ts` re-exports the classic surface plus the planner and display helpers:

- Classes: `Team`, `TeamLead`, `Teammate`, `TaskList`, `Mailbox`
- Planner: `planTeam(taskDescription, options?)`, `buildTeammateOptionsFromPlan(plan, baseEngineOptions?, logger?)`, and types `TeamPlan`, `PlannerOptions`
- Display: `InProcessDisplay` — a terminal renderer that subscribes to a `Team`'s event stream (`start()` / `stop()`, optional `{ showOutput }`). Use it to render live progress for the classic `Team`:

```typescript
import { Team, InProcessDisplay } from 'pulse-coder-agent-teams';

const team = new Team({ name: 'my-team', cwd: '/path/to/project' });
const display = new InProcessDisplay(team, { showOutput: false });
display.start();
// ... spawn, create tasks, team.run() ...
display.stop();
```

- Types: `EngineOptions`, `TeamConfig`, `TeamStatus`, `TeamMemberInfo`, `PersistedTeamConfig`, `TeammateOptions`, `TeammateStatus`, `Task`, `CreateTaskInput`, `TaskStatus`, `TeamMessage`, `MessageType`, `TeamHooks`, `TeamEvent`, `TeamEventType`, `TeamEventHandler`, `DisplayMode`

## Protocol Runtime (`./runtime`)

The `./runtime` subpath export is a second, host-driven coordination surface. Unlike the classic `Team` (which owns `Engine` instances and the execution loop in-process), `TeamRuntime` is a stateful protocol runtime: it persists teams, agents, tasks, artifacts, human gates, mailbox messages, and events in a `TeamRuntimeStore`, and drives actual agent sessions through a host-supplied `AgentSessionAdapter`. The runtime itself has **no process or filesystem access** — hosts run verification commands, enforce handoff-file presence, and own PTY/session behavior.

Import:

```typescript
import { TeamRuntime, InMemoryTeamRuntimeStore } from 'pulse-coder-agent-teams/runtime';
import type { AgentSessionAdapter, TeamRuntimeStore } from 'pulse-coder-agent-teams/runtime';
```

`new TeamRuntime(options?: TeamRuntimeOptions)` — options: `store?` (defaults to `InMemoryTeamRuntimeStore`), `agentSessions?` (the `AgentSessionAdapter`), `now?`, `idFactory?`, and `taskHandoffPath?` (resolves a task's handoff file path; enforcing its existence is the host's job).

Key `TeamRuntime` methods (grouped by concern; see `src/runtime/team-runtime.ts` for full signatures):

- **Team lifecycle / snapshot**: `createTeam`, `deleteTeam`, `setTeamStatus`, `completeTeam`, `snapshot` (returns a `RuntimeSnapshot` of the whole team)
- **Agents / sessions**: `addAgent`, `createAgentSession`, `sendToAgent`, `interruptAgent`
- **Tasks**: `createTask`, `dispatchReadyTasks` (returns `DispatchResult` of assigned tasks + idle agents), `submitTaskCompletion` (accepts a host-produced `TaskVerificationResult`), `completeTask`, `requestTaskReview`, `failTask`, `cancelTask`, `blockTask`, `updateTaskDescription`
- **Rounds / checkpoints / pause**: `initializeRound`, `advanceRound`, `finalizeFromCheckpoint`, `repairCurrentRound`, `pauseTeam` / `resumeTeam`, `pauseDispatch` / `resumeDispatch`
- **Human gates**: `openHumanGate`, `answerHumanGate`, `notifyLeadPendingGates`
- **Artifacts**: `createArtifact`
- **Lead notifications**: `notifyLeadPendingTaskReviews`, `notifyLeadAttention`, `notifyLeadPlanApproved`, `notifyLeadReviewIfStalled`

Contracts and record types (`src/runtime/types.ts`):

- `TeamRuntimeStore` — persistence interface: teams use `save`/`get`/`delete`; agents, tasks, and human gates use `save`/`get`/`list`; artifacts use `save`/`list`; events and mailbox messages use `append`/`list`. `InMemoryTeamRuntimeStore` is the default and is used by tests and lightweight hosts.
- `AgentSessionAdapter` — host bridge: `createSession`, `sendInput`, `interrupt` (`'soft' | 'ctrl-c' | 'abort'`), `getStatus`, optional `persistLaunchPrompt` and `onEvent`.
- Records: `AgentTeamRecord`, `TeamAgentRecord`, `TeamTaskRecord`, `TeamArtifactRecord`, `HumanGateRecord`, `MailboxMessage`, `TeamEvent`, plus `RuntimeSnapshot`, `DispatchResult`, `TaskVerificationResult`, and the status unions (`TeamStatus`, `AgentStatus`, `TaskStatus`, `HumanGateStatus`, `ArtifactKind`, `MailboxMessageType`, `TeamEventType`).
- Task metadata helpers (shared with hosts): `TASK_METADATA_KEYS` (`round`, `scope`, `verify`, `lastVerify`, `blockedByFailedDep`), `readCurrentRound`, `readTaskRound`, `readTaskScope`, `readTaskVerification`, `readTaskVerifyCommand`.
- DAG helpers: `assertTaskGraphAcyclic`, `findTaskGraphCycle` (`src/runtime/task-graph.ts`).

Contract intent, invariants, and consumers (`apps/teams-cli`, `apps/canvas-workspace`, the engine built-in agent-teams integration) live in `docs/contracts.md`. Public runtime exports are contracts — route changes through `harness/skills/contract-coding.md`.

## Build & Test

```bash
pnpm --filter pulse-coder-agent-teams build
pnpm --filter pulse-coder-agent-teams test
pnpm --filter pulse-coder-agent-teams typecheck
```
