# Workspace AGENTS.md Template

> This file is the local entry for `<workspace>`.
> Repository harness entry: `../../harness/README.md` or the correct relative path.

## Module Positioning

What this workspace owns and what it does not own.

## Knowledge Navigation

| Task | Read |
|---|---|
| Understand public contracts | `docs/contracts.md` |
| Pick validation | `docs/validation.md` |
| Understand package scripts | `package.json` |

## Local Constraints

- Keep facts local to the workspace unless they are repository-wide.
- Route contract changes through `harness/skills/contract-coding.md`.
- Route reusable feedback through `harness/skills/feedback-governance.md`.

## Common Commands

```bash
pnpm --filter <package-name> test
pnpm --filter <package-name> typecheck
pnpm --filter <package-name> build
```

## Key Files

- `src/index.ts`:
