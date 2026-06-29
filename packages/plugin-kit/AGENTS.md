# AGENTS.md - packages/plugin-kit

> Local entry for `packages/plugin-kit`.
> Repository harness entry: `../../harness/README.md`.

## Module Positioning

`pulse-coder-plugin-kit` provides shared infrastructure for runtime plugins and hosts. It currently contains three reusable subsystems:

- Worktree binding: file-backed worktree records, scope-to-worktree bindings, `AsyncLocalStorage` run context, and a prompt-injection engine plugin.
- Vault binding: file-backed per-project/per-tenant workspace directories, vault resolution, prompt injection, and the optional `vault_inspect` tool.
- Devtools: run, LLM, tool, compaction, hook timing, prompt snapshot, token/cost, tool-stat, error, and cache timeline diagnostics.

This package should expose reusable infrastructure primitives. Host-specific policy should stay in the host app or plugin using the kit.

## Knowledge Navigation

| Task | Read |
|---|---|
| Package overview | `README.md` |
| Public exports | `src/index.ts`, `src/worktree.ts`, `src/vault.ts`, `src/devtools.ts` |
| Worktree contracts | `src/worktree/types.ts`, `src/worktree/service.ts`, `src/worktree/integration.ts` |
| Vault contracts | `src/vault/types.ts`, `src/vault/service.ts`, `src/vault/integration.ts`, `src/vault/tools.ts` |
| Devtools contracts | `src/devtools/index.ts` |
| Build/export shape | `package.json`, `tsup.config.ts`, `tsconfig.json` |

## Local Constraints

- Keep utilities host-neutral and reusable.
- Do not commit secrets, vault contents, worktree state, prompt snapshots, or host-local runtime data from `~/.pulse-coder/*`.
- Export path changes are public contract changes; coordinate with consumers.
- Worktree behavior should be conservative around user changes and branch state.
- Vault paths are for artifacts/config/logs, not a substitute for git worktree paths.
- Devtools may capture user text, prompts, tool inputs/outputs, and generated text. Keep redaction and `saveUserText`/prompt capture options intact when changing diagnostics.
- Services use file-backed JSON with queued writes in-process; do not assume cross-process locking without adding it deliberately.

## Common Commands

For docs-only changes, use the harness docs rule: check referenced paths and commands.

```bash
SKIP_DTS=1 pnpm --filter pulse-coder-plugin-kit build
```

`test` is not a routine command for this package right now: `package.json` defines it, but there are no `*.test.ts` or `*.spec.ts` files, so `vitest run` exits non-zero. `typecheck` is listed in harness validation, but currently fails locally with TS6059 `rootDir` errors from engine/orchestrator source imports plus deep Zod/FlexibleSchema type instantiation errors in `src/devtools/index.ts` and `src/vault/tools.ts`. Default `build` runs declaration generation, so use the skipped-DTS build only as a JS packaging smoke until the TypeScript boundary is fixed.

## Key Files

- `src/index.ts`: umbrella public exports.
- `src/worktree.ts`, `src/worktree/index.ts`: worktree subpath exports.
- `src/worktree/service.ts`: `FileWorktreePluginService`, worktree CRUD, and scope binding state.
- `src/worktree/integration.ts`: worktree engine plugin and run context adapter.
- `src/vault.ts`, `src/vault/index.ts`: vault subpath exports.
- `src/vault/service.ts`: `FileVaultPluginService` and vault directory/index management.
- `src/vault/integration.ts`: vault engine plugin, resolver, prompt injection, and inspect-tool registration.
- `src/vault/tools.ts`: `vault_inspect` tool implementation.
- `src/devtools.ts`, `src/devtools/index.ts`: devtools store, engine plugin, run lookup tool, stats, errors, prompt snapshots, and cache timeline analysis.
- `package.json`: package exports and build behavior.
