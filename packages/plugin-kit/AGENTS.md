# AGENTS.md - packages/plugin-kit

> Local entry for `packages/plugin-kit`.
> Repository harness entry: `../../harness/README.md`.

## Module Positioning

`pulse-coder-plugin-kit` is the umbrella package for engine plugins and plugin infrastructure. It currently contains five reusable subsystems, each behind its own subpath export:

- Worktree binding (`/worktree`): file-backed worktree records, scope-to-worktree bindings, `AsyncLocalStorage` run context, and a prompt-injection engine plugin.
- Vault binding (`/vault`): file-backed per-project/per-tenant workspace directories, vault resolution, prompt injection, and the optional `vault_inspect` tool.
- Devtools (`/devtools`): run, LLM, tool, compaction, hook timing, prompt snapshot, token/cost, tool-stat, error, and cache timeline diagnostics.
- Memory (`/memory`): host-side memory service, engine plugin integration, daily-log extraction, semantic/keyword recall, embeddings (carries the `better-sqlite3` native dep). Formerly the standalone `memory-plugin` package.
- Langfuse (`/langfuse`): optional observability engine plugin. Formerly `packages/langfuse-plugin`.
- Goal (`/goal`): file-backed goal store, goal engine plugin (prompt injection + `goal_set`/`goal_status`/`goal_clear`/`goal_complete` tools), and integration factory. Hosts own the continuation budget: the plugin never loops the engine, the host decides what to do after each run based on goal state.

This package should expose reusable infrastructure primitives and engine plugins. Host-specific policy should stay in the host app or plugin using the kit.

## Knowledge Navigation

| Task | Read |
|---|---|
| Package overview | `README.md` |
| Public exports | `src/index.ts`, `src/worktree.ts`, `src/vault.ts`, `src/devtools.ts` (+ subpath entries `src/memory/index.ts`, `src/langfuse/index.ts`) |
| Worktree contracts | `src/worktree/types.ts`, `src/worktree/service.ts`, `src/worktree/integration.ts` |
| Vault contracts | `src/vault/types.ts`, `src/vault/service.ts`, `src/vault/integration.ts`, `src/vault/tools.ts` |
| Devtools contracts | `src/devtools/index.ts` |
| Memory module (invariants, layered storage, embeddings) | `harness/knowledge/memory.md` |
| Langfuse module (privacy defaults, flushing contract) | `harness/knowledge/langfuse.md` |
| Goal module (store, plugin, continuation contract) | `src/goal/` (types/service/integration), `src/goal.ts` |
| Build/export shape | `package.json`, `tsup.config.ts`, `tsconfig.json` |

## Local Constraints

- Keep utilities host-neutral and reusable.
- Do not commit secrets, vault contents, worktree state, prompt snapshots, or host-local runtime data from `~/.pulse-coder/*`.
- Export path changes are public contract changes; coordinate with consumers.
- Worktree behavior should be conservative around user changes and branch state.
- Vault paths are for artifacts/config/logs, not a substitute for git worktree paths.
- Devtools may capture user text, prompts, tool inputs/outputs, and generated text. Keep redaction and `saveUserText`/prompt capture options intact when changing diagnostics.
- Services use file-backed JSON with queued writes in-process; do not assume cross-process locking without adding it deliberately.
- Memory: semantic recall must degrade safely when embeddings/SQLite are unavailable; preserve daily-log quality gates/quotas/dedupe; layered storage layout and legacy `state.json` migration are compatibility contracts (detail: `harness/knowledge/memory.md`).
- Langfuse: stays optional; credentials env-only; `saveUserText`/`saveLLMOutput` default ENABLED (privacy is a host decision); never block the loop on flushing (detail: `harness/knowledge/langfuse.md`).
- Goal: the plugin is prompt/tool-only — it never auto-continues the engine loop. `setScope` must keep the same service instance bound (hosts switch session scope in place, like `TaskListService.setTaskListId`). Scope names are file names: dots excluded on purpose to keep `..` out of the storage path.

## Common Commands

For docs-only changes, use the harness docs rule: check referenced paths and commands.

```bash
SKIP_DTS=1 pnpm --filter pulse-coder-plugin-kit build
pnpm --filter pulse-coder-plugin-kit test
```

`test` runs the real memory specs (`src/memory/service.test.ts`, `src/memory/integration.test.ts`); the former `--passWithNoTests` flag is gone. Coverage is memory-only — worktree/vault/devtools/langfuse still have no specs, so green ≠ coverage there. `typecheck` is listed in harness validation, but currently fails locally with TS6059 `rootDir` errors from engine source imports plus deep Zod/FlexibleSchema type instantiation errors in `src/devtools/index.ts` and `src/vault/tools.ts`. Default `build` runs declaration generation, so use the skipped-DTS build only as a JS packaging smoke until the TypeScript boundary is fixed.

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
- `src/memory/service.ts`, `src/memory/integration.ts`: memory service, engine hooks, and tools (see `harness/knowledge/memory.md`).
- `src/langfuse/index.ts`: Langfuse plugin factory and options.
- `src/goal/`: goal store (`service.ts`), engine plugin + integration factory (`integration.ts`), types (`types.ts`), subpath barrel (`index.ts`).
- `src/goal.ts`: top-level goal subpath export (mirrors `worktree.ts`/`vault.ts`).
- `package.json`: package exports and build behavior.
