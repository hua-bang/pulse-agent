# pulse-coder-agent-teams

Multi-session collaborative agent coordination layer for Pulse Coder. Each teammate gets its own independent `Engine` instance (and thus its own context window, model, and toolset) while sharing a common task queue and mailbox.

## Architecture

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
| `TaskList` | Shared in-memory + file-backed task queue with dependency resolution and work-stealing guard |
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
console.log(stats); // { total, completed, failed, skipped }

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
  deps: string[];       // IDs of tasks that must complete first
  assignee: string | null;
  createdBy: string;
  result?: string;      // populated on completion
}
```

Tasks without pending deps are immediately claimable. When a task completes its result is automatically injected as context into dependent tasks.

## Teammate Tools

Every teammate is automatically equipped with team-aware tools:

| Tool | Description |
|------|-------------|
| `team_complete_task` | Mark the current task as done with a result summary |
| `team_send_message` | Send a message to a specific teammate |
| `team_notify_lead` | Send a message to the team lead |
| `team_list_tasks` | List tasks filtered by status or assignee |
| `team_get_messages` | Read unread mailbox messages |

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

Event types: `teammate:spawned`, `teammate:idle`, `teammate:stopped`, `teammate:status`, `teammate:output`, `teammate:run_start`, `teammate:run_end`, `task:created`, `task:claimed`, `task:completed`, `task:failed`, `message:sent`, `message:received`, `team:phase`, `team:started`, `team:completed`, `team:cleanup`.

## Plan Approval

Set `requirePlanApproval: true` on a `TeammateOptions` to put that teammate in plan mode. The teammate submits its plan via mailbox before executing; the lead (or a hook) sends a `plan_approval_response` to approve or reject with feedback.

## Build & Test

```bash
pnpm --filter pulse-coder-agent-teams build
pnpm --filter pulse-coder-agent-teams test
pnpm --filter pulse-coder-agent-teams typecheck
```
