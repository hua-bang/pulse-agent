# AGENTS.md - packages/plugin-kit

> Local entry for `packages/plugin-kit`.
> Repository harness entry: `../../harness/README.md`.

## Module Positioning

`pulse-coder-plugin-kit` provides shared utilities for runtime plugins and hosts, including worktree integration, vault/secret storage, and devtools helpers.

This package should expose reusable infrastructure primitives. Host-specific policy should stay in the host app or plugin using the kit.

## Knowledge Navigation

| Task | Read |
|---|---|
| Package overview | `README.md` |
| Public exports | `src/index.ts` |
| Worktree utilities | `src/worktree.ts`, `src/worktree/` |
| Vault utilities | `src/vault.ts`, `src/vault/` |
| Devtools utilities | `src/devtools.ts`, `src/devtools/` |
| Package exports | `package.json` |

## Local Constraints

- Keep utilities host-neutral and reusable.
- Do not commit secrets or host-local state.
- Export path changes are public contract changes; coordinate with consumers.
- Worktree behavior should be conservative around user changes and branch state.

## Common Commands

```bash
pnpm --filter pulse-coder-plugin-kit test
pnpm --filter pulse-coder-plugin-kit typecheck
pnpm --filter pulse-coder-plugin-kit build
```

## Key Files

- `src/index.ts`: public package entry.
- `src/worktree.ts` and `src/worktree/`: worktree integration.
- `src/vault.ts` and `src/vault/`: vault and secret helpers.
- `src/devtools.ts` and `src/devtools/`: devtools integration.
- `package.json`: package exports and build behavior.
