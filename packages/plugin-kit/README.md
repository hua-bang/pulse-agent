# pulse-coder-plugin-kit

Shared toolkit for building Engine plugins. Provides three subsystems — **Worktree**, **Vault**, and **Devtools** — each with a file-backed service/store, an integration factory that bundles an `enginePlugin`, and per-run context wiring. Worktree and Vault carry an `AsyncLocalStorage`-based run context; Devtools tracks run identity via a `WeakMap<Context, string>` instead (see [Shared shape and divergences](#shared-shape-and-divergences)).

> For repo-local constraints, key-file map, and the honest command reality, see [`AGENTS.md`](./AGENTS.md). This README is a package-level overview; it does not duplicate rule bodies that live there or in `harness/`.

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
| `FileWorktreePluginService` | File-backed state at `~/.pulse-coder/worktree-state/` (state file `state.json`) — CRUD for worktrees and scope→worktree bindings |
| `createWorktreeIntegration(options)` | Factory returning `{ service, enginePlugin, initialize(), withRunContext(context, run), getRunContext() }` |
| `createWorktreeEnginePlugin(options)` | Lower-level factory (the integration already bundles an `enginePlugin`). Takes `CreateWorktreeEnginePluginOptions` (`{ service, getRunContext, name?, version?, promptHeader? }`), returns an `EnginePlugin` that injects the bound worktree path into the system prompt via `beforeRun` |
| `setWorktreeBinding(service, input)` | Upsert a worktree and bind a scope to it |
| `clearWorktreeBinding(service, scope)` | Remove a scope→worktree binding |

### Data model

- **WorktreeRecord** — `{ id, repoRoot, worktreePath, branch?, createdAt, updatedAt }`
- **WorktreeBindingRecord** — `{ key, runtimeKey, scopeKey, worktreeId, updatedAt }`
- Scope = `{ runtimeKey, scopeKey }` — e.g. `{ runtimeKey: 'discord', scopeKey: 'channel:123' }`
- `CreateWorktreeIntegrationOptions` extends `FileWorktreeServiceOptions` (`baseDir?`) with `service?`, `runContextAdapter?`, `pluginName?`, `pluginVersion?`, `promptHeader?`

## Vault

Manages isolated workspace directories for per-project or per-tenant state (config files, artifacts, logs).

### Key exports

| Export | Description |
|--------|-------------|
| `FileVaultPluginService` | File-backed state at `~/.pulse-coder/workspace-state/` (state file `state.json`); vault directories live under `workspace-state/workspaces/<id>/`. `ensureVaultDirectories()` creates only the vault `root`, `artifacts/`, and `logs/` |
| `createVaultIntegration(options)` | Factory returning `{ service, enginePlugin, initialize(), withRunContext(context, run), getRunContext(), getVault(input?) }` |
| `createVaultEnginePlugin(options)` | Lower-level factory (the integration already bundles an `enginePlugin`). Takes `CreateVaultEnginePluginOptions` (`{ service, getRunContext, name?, version?, promptHeader?, resolver? }`), returns an `EnginePlugin` that injects the vault path into the system prompt via `beforeRun` and **unconditionally** registers a `vault_inspect` tool (there is no opt-out flag) |
| `resolveCurrentVault(input)` | Standalone resolver: runs the configured `VaultResolver` against the current run context and ensures the resulting vault |

> Vault paths: `configPath` and `statePath` resolve to **files** (`config.json`, `state.json`) inside the vault root, not subdirectories. Only `artifacts/` and `logs/` are directories.

### Data model

- **VaultRecord** — `{ id, key, attributes?, createdAt, updatedAt }`
- **VaultContext** — extends `VaultRecord` with resolved paths: `root`, `configPath` (`config.json`), `statePath` (`state.json`), `artifactsPath`, `logsPath`
- `CreateVaultIntegrationOptions` extends `FileVaultServiceOptions` (`baseDir?`) with `service?`, `runContextAdapter?`, `pluginName?`, `pluginVersion?`, `promptHeader?`, `resolver?`

## Devtools

Records detailed telemetry for debugging and analytics. Tracks LLM calls, tool executions, compaction events, hook timing, prompt snapshots, token/cost, tool stats, errors, and cache-timeline analysis.

### Key exports

| Export | Description |
|--------|-------------|
| `DevtoolsStore` | In-memory + file-backed store at `~/.pulse-coder/devtools/` (`runs/<runId>.json` + `index.json`). Exposes `listRuns`, `getRun`, `getTokenStats`, `getToolStats`, `getErrors`, `getLlmPromptSnapshot` |
| `createDevtoolsIntegration(options)` | Factory returning `{ store, enginePlugin, initialize() }` (note: `store`, not `service`). Registers hooks and, unless `enableTool: false`, a `devtools_run_get` tool |
| `analyzeCacheTimeline(spans, options?)` | Standalone function building a cache-aware timeline across one or many runs, flagging breakpoints where cache reads drop below expectation |

### Registered hooks

The devtools engine plugin registers: `beforeRun` (starts a run and wraps tools), `beforeLLMCall` (captures the prompt/messages snapshot + input tokens), `afterLLMCall`, `onToolCall`, `onCompacted`, `afterRun`, plus an `events.on('hookTiming')` listener that records per-plugin-hook durations. There is no `afterToolCall` hook — tool calls are recorded via `onToolCall` plus the `beforeRun`/`beforeLLMCall` tool wrappers.

### Tracked data

- **Run spans** — start/end, status, tool/LLM/compaction counts, token totals, distinct models, error count, estimated cost (USD, when a model price resolves; the built-in table covers common Anthropic/OpenAI/Gemini models by default)
- **LLM call spans** — model, finish reason, token usage, timing (request start → first chunk → first text → last chunk), inline system-prompt preview, message/tool-name metadata, optional prompt-snapshot ref
- **Tool call spans** — name, input/output size + preview, duration, error
- **Compaction events** — attempt, trigger, forced flag, before/after message counts, token estimates, strategy
- **Prompt snapshots** — `runs/<runId>/llm/<index>.json`; system prompt + messages, with head+tail windowing when the byte limit is exceeded
- **Plugin hook spans** — plugin name, hook name, started-at, duration

### Options

`DevtoolsIntegrationOptions` extends `DevtoolsStoreOptions` with `pluginName?`, `pluginVersion?`, `toolName?` (default `devtools_run_get`), `enableTool?` (default `true`). `DevtoolsStoreOptions` fields:

| Option | Default | Purpose |
|--------|---------|---------|
| `baseDir?` | `~/.pulse-coder/devtools` | Storage root (`runs/` + `index.json`) |
| `flushDelayMs?` | `200` | Debounce for file flushes |
| `maxEntries?` | `500` | Max index entries retained |
| `saveUserText?` | `true` | Whether to persist raw user text |
| `capturePrompts?` | `true` | Whether to capture LLM prompt/messages snapshots |
| `promptSnapshotLimitBytes?` | `256 * 1024` | Per-snapshot byte limit (head+tail windowing above it) |
| `promptRedactor?` | `defaultRedact` | Custom redactor applied to prompt content |
| `modelPrices?` | built-in Anthropic/OpenAI/Gemini table | USD-per-1M-token price table for cost estimation |

### Secret redaction

Prompt snapshots run through `defaultRedact()` (Authorization/Bearer headers, `sk-` keys, generic `api_key`/`secret`/`token`/`password`, AWS access keys, emails, phone numbers) before persistence. Supply a custom `promptRedactor` to extend or replace this. Keep redaction intact when changing diagnostics — see `AGENTS.md`.

## Shared shape and divergences

All three subsystems share a common shape: a file-backed service/store with JSON persistence, and an integration factory that bundles an `enginePlugin` plus `initialize()`. They diverge in context handling, persistence strategy, and tool registration:

| Aspect | Worktree | Vault | Devtools |
|--------|----------|-------|----------|
| Integration exposes | `service` | `service` | `store` |
| Per-run context | `AsyncLocalStorage` (`withRunContext`/`getRunContext`) | `AsyncLocalStorage` (`withRunContext`/`getRunContext`) | `WeakMap<Context, string>` runId tracking (no `withRunContext`) |
| `beforeRun` use | system-prompt injection | system-prompt injection | start run + wrap tools (no prompt injection) |
| Persistence | atomic (temp-file + `rename`) | atomic (temp-file + `rename`) | debounced direct `writeFile` (not atomic) |
| Tool registration | none | `vault_inspect` (unconditional) | `devtools_run_get` (gated by `enableTool`) |

## Storage locations

| Subsystem | Default path | Contents |
|-----------|--------------|----------|
| Worktree | `~/.pulse-coder/worktree-state/` | `state.json` (worktrees + bindings) |
| Vault | `~/.pulse-coder/workspace-state/` | `state.json` (vault index); `workspaces/<id>/` vault dirs (`config.json`, `state.json`, `artifacts/`, `logs/`) |
| Devtools | `~/.pulse-coder/devtools/` | `index.json` (run summaries); `runs/<runId>.json` (full records); `runs/<runId>/llm/<index>.json` (prompt snapshots) |

## Build & Test

```bash
SKIP_DTS=1 pnpm --filter pulse-coder-plugin-kit build   # JS packaging smoke (tsup only)
pnpm --filter pulse-coder-plugin-kit build               # also generates .d.ts via tsc
```

The build is two-step: `tsup` for JS and a separate `tsc -p tsconfig.types.json` for declarations. Set `SKIP_DTS=1` (or `TSUP_SKIP_DTS=1`) to skip declaration generation.

> **Honest command reality** (see `AGENTS.md`): `test` (`vitest run`) is **not** a routine green command here — there are zero `*.test.ts`/`*.spec.ts` files and no `--passWithNoTests`, so it exits non-zero. `typecheck` (`tsc --noEmit`) currently fails locally with TS6059 `rootDir` errors from engine/orchestrator source imports plus deep Zod type-instantiation errors in `src/devtools/index.ts` and `src/vault/tools.ts`. Use the skipped-DTS build above as the JS smoke check until the TypeScript boundary is fixed.
