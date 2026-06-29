# AGENTS.md - packages/agent-teams

> Local entry for `packages/agent-teams`.
> Repository harness entry: `../../harness/README.md`.

## Module Positioning

`pulse-coder-agent-teams` owns multi-session team coordination on top of the engine and orchestrator. It manages team lifecycle, task dispatch, review gates, checkpoints, scope controls, and runtime state for collaborative agents.

It should keep team protocol behavior explicit and avoid hiding quality gates in prompts alone.

## Knowledge Navigation

| Task | Read |
|---|---|
| Understand contracts | `docs/contracts.md` |
| Pick validation | `docs/validation.md` |
| Maturity roadmap | `../../docs/07-agent-teams-maturity-roadmap.md` |
| Runtime implementation | `src/runtime/team-runtime.ts` |
| Package scripts | `package.json` |

## Local Constraints

- Team completion should mean deliverable evidence, not only an agent claim.
- Verify commands, handoff material, review state, and dependency blocking are protocol-level concerns.
- Scope and task ownership changes should stay explicit.
- Public runtime exports are contracts; route changes through `harness/skills/contract-coding.md`.

## Common Commands

```bash
pnpm --filter pulse-coder-agent-teams test
pnpm --filter pulse-coder-agent-teams typecheck
pnpm --filter pulse-coder-agent-teams build
```

## Key Files

- `src/runtime/team-runtime.ts`: team lifecycle, dispatch, review, checkpoints, scope handling.
- `src/index.ts`: package exports.
- `package.json`: package scripts and runtime dependencies.
