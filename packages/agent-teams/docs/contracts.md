# Agent Teams Contracts

## Scope

`packages/agent-teams` coordinates multiple agents working as a team. It sits above the engine/orchestrator and below host UIs or CLIs that expose team workflows.

## Public Contracts

- Team lifecycle state must be observable and recoverable enough for hosts to display progress and resume work.
- Task dispatch, completion, review, failure, and dependency blocking are protocol states, not just text conventions.
- Verification commands and handoff artifacts are part of task quality evidence.
- Runtime APIs exported through package entrypoints are public to consumers such as `apps/teams-cli` and `apps/canvas-workspace`.

## Invariants

- Lead/reviewer style decisions should not silently bypass protocol permissions.
- Tasks that fail or are rejected should not unblock dependents until the state is resolved.
- Checkpoint and completion behavior must preserve enough state for human review.
- Runtime state changes should be deterministic and auditable where possible.

## Extension Boundaries

- Add team protocol capabilities in runtime/service boundaries, not by relying only on prompt text.
- Host-specific UI behavior belongs in the host app or CLI.
- Verification and reporting rules should align with `../../docs/07-agent-teams-maturity-roadmap.md`.

## Consumers

Known consumers include:

- `apps/teams-cli`
- `apps/canvas-workspace`
- `packages/engine` built-in agent-teams plugin integration

## Validation

See `docs/validation.md`.
