# AGENTS.md - packages/acp

> Local entry for `packages/acp`.
> Repository harness entry: `../../harness/README.md`.

## Module Positioning

`pulse-coder-acp` owns the Agent Context Protocol client, runner, typed protocol models, and state store used by Pulse Coder hosts.

ACP protocol behavior is contract-heavy. Changes should preserve compatibility expectations for hosts that create ACP sessions or resume state.

## Knowledge Navigation

| Task | Read |
|---|---|
| Package overview | `README.md` |
| Public exports | `src/index.ts` |
| Protocol types | `src/types.ts` |
| Client behavior | `src/client.ts` |
| Runner behavior | `src/runner.ts` |
| State management | `src/state.ts`, `src/state-store.ts` |
| Tests | `src/*.test.ts` |

## Local Constraints

- Treat protocol types, runner behavior, and state persistence as public contracts.
- Avoid host-specific policy in the ACP package.
- State compatibility changes should include tests or a migration note.
- Route protocol changes through `harness/skills/contract-coding.md`.

## Common Commands

```bash
pnpm --filter pulse-coder-acp test
pnpm --filter pulse-coder-acp typecheck
pnpm --filter pulse-coder-acp build
```

## Key Files

- `src/types.ts`: ACP protocol types.
- `src/client.ts`: client transport behavior.
- `src/runner.ts`: session runner behavior.
- `src/state.ts`, `src/state-store.ts`: state model and persistence.
- `src/index.ts`: public exports.
