# pulse-coder-plugin-kit

Shared toolkit for building Engine plugins. Provides three subsystems — **Worktree**, **Vault**, and **Devtools** — each with a file-backed service, an engine plugin factory, and `AsyncLocalStorage`-based per-run context management.

## Subpath Exports

```typescript
import { ... } from 'pulse-coder-plugin-kit';            // everything
import { ... } from 'pulse-coder-plugin-kit/worktree';   // worktree only
import { ... } from 'pulse-coder-plugin-kit/vault';      // vault only
import { ... } from 'pulse-coder-plugin-kit/devtools';   // devtools only
```

## Worktree

Manages git worktree bindings so that multi-tenant sessions (e.g. Discord channels) each resolve to their own worktree directory.

### Key exports

| Export | Description |
|--------|-------------|
| `FileWorktreePluginService` | File-backed state at `~/.pulse-coder/worktree-state/` — CRUD for worktrees and scope→worktree bindings |
| `createWorktreeIntegration(options)` | Factory that returns `{ service, initialize(), buildRunContext(scope) }` |
| `createWorktreeEnginePlugin(integration)` | Returns an `EnginePlugin` that injects worktree cwd into the system prompt via `beforeRun` hook |

### Data model

- **WorktreeRecord** — `{ id, repoRoot, worktreePath, branch? }`
- **WorktreeBindingRecord** — `{ runtimeKey, scopeKey } → worktreeId`
- Scope = `{ runtimeKey, scopeKey }` — e.g. `{ runtimeKey: 'discord', scopeKey: 'channel:123' }`

## Vault

Manages isolated workspace directories for per-project or per-tenant state (config files, artifacts, logs).

### Key exports

| Export | Description |
|--------|-------------|
| `FileVaultPluginService` | File-backed state at `~/.pulse-coder/vault-state/` — ensures vault dirs with standard subdirectories (`config/`, `state/`, `artifacts/`, `logs/`) |
| `createVaultIntegration(options)` | Factory with `{ service, initialize(), resolveVault(input) }` |
| `createVaultEnginePlugin(integration)` | Returns an `EnginePlugin` that injects vault path into system prompt and optionally registers a `vault_inspect` tool |

### Data model

- **VaultRecord** — `{ id, key, attributes? }`
- **VaultContext** — extends VaultRecord with resolved paths: `root`, `configPath`, `statePath`, `artifactsPath`, `logsPath`

## Devtools

Records detailed telemetry for debugging and analytics. Tracks LLM calls, tool executions, compaction events, and more.

### Key exports

| Export | Description |
|--------|-------------|
| `DevtoolsStore` | In-memory + file-backed store for run spans and events |
| `createDevtoolsIntegration(options)` | Factory that returns an engine plugin hooking into `afterLLMCall`, `afterToolCall`, `onCompacted`, `beforeRun`, `afterRun` |

### Tracked data

- **Run spans** — start/end, status, tool calls, LLM calls, compaction events
- **LLM call spans** — model, finish reason, token usage, timing (request start → first chunk → first text → last chunk)
- **Tool call spans** — name, input, output, duration
- **Compaction events** — before/after message counts, token estimates, strategy used

## Shared Patterns

All three subsystems follow the same structure:
1. **Service** — `File*PluginService` with atomic JSON persistence
2. **Integration** — factory function returning `{ service, initialize(), ... }` plus `AsyncLocalStorage`-based per-run context
3. **Engine plugin** — registers `beforeRun` hooks for system prompt injection and optional tools

## Build & Test

```bash
pnpm --filter pulse-coder-plugin-kit build
pnpm --filter pulse-coder-plugin-kit test
pnpm --filter pulse-coder-plugin-kit typecheck
```

Note: the build uses a two-step process (`tsup` for JS + separate `tsc` for declarations). Set `SKIP_DTS=1` to skip declaration generation.
