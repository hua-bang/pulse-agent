# AGENTS.md - packages/canvas-cli

> Local entry for `packages/canvas-cli`.
> Repository harness entry: `../../harness/README.md`.

## Module Positioning

`@pulse-coder/canvas-cli` owns the `pulse-canvas` command-line surface and the
`@pulse-coder/canvas-cli/core` helpers for external agents that need to inspect
or mutate Pulse Canvas workspaces.

Most commands operate on the local canvas store under `~/.pulse-coder/canvas/`
without a running app. Unactivated stores retain v1/v2 JSON; database-owned
activation selects the shared SQLite adapter for the `canvas` domain. Markdown
and attachments remain files. After activation the workspace manifest lives in
the database too; `__workspaces__.json` is imported once and then not read or written.
The `agent`, `team`, and `runtime` command families are different: they require a running `apps/canvas-workspace` instance
and call its loopback runtime-control server using the bearer secret advertised
in `~/.pulse-coder/canvas-runtime/canvas-workspace.json`.

Keep this package a thin bridge over storage contracts and runtime endpoints. The
Electron UI, active PTY lifecycle, storage migration, runtime server, and
runtime-loadable plugin node behavior all belong in `apps/canvas-workspace`.

## Knowledge Navigation

| Task | Read |
|---|---|
| Repository harness and root validation | `../../harness/README.md`, `../../harness/validate/validation.yaml` |
| Package overview and install flow | `README.md` |
| Current CLI command index | `src/cli.ts` |
| Executable entrypoint | `src/index.ts` |
| Workspace/node/edge/context commands | `src/commands/workspace.ts`, `src/commands/node.ts`, `src/commands/edge.ts`, `src/commands/context.ts` |
| Workspace auto-discovery (which canvas a command targets) | `src/core/workspace-resolution.ts`, `src/commands/options.ts` |
| External-caller surface (status/describe, error contract) | `src/commands/status.ts`, `src/commands/describe.ts`, `src/output.ts` |
| Live runtime commands and capability client | `src/commands/agent.ts`, `src/commands/team.ts`, `src/commands/runtime.ts`, `src/core/runtime-control.ts`, `src/core/runtime-capabilities.ts` |
| v2 recovery command | `src/commands/restore.ts` |
| Consistency check + safe repair (drift/orphans/edges) | `src/commands/doctor.ts`, `src/core/doctor.ts` |
| Layout read/validate/frame-grid | `src/commands/layout.ts`, `src/core/layout.ts` |
| Validated batch mutation and file recovery | `src/commands/apply.ts`, `src/core/apply.ts` |
| Public core exports | `src/core/index.ts` |
| Store safety and schema compatibility | `src/core/store.ts`, `src/core/storage-v2.ts`, `src/core/types.ts`, `src/core/constants.ts` |
| SQLite activation, revisions, file recovery, native runtime | `src/core/sqlite-store.ts`, `src/core/sqlite-file-writes.ts`, `src/core/sqlite-doctor.ts`, `src/core/native-binding.ts`, `../storage/AGENTS.md` |
| Store-concurrency incident + lock rationale | `harness/knowledge/storage-concurrency.md` |
| Node and edge behavior | `src/core/nodes.ts`, `src/core/edges.ts` |
| Bundled agent skills | `skills/`, `src/commands/install-skills.ts` |
| Tests | `src/core/__tests__/`, `src/commands/__tests__/` |
| Local validation | `harness/validate/validation.yaml` |

Package-local documentation: `harness/knowledge/storage-concurrency.md` (the
store-concurrency incident behind the locking constraints) and
`harness/validate/validation.yaml`. Beyond those, use the root harness files
above, then the package source/tests.

## Local Constraints

- Treat `~/.pulse-coder/canvas/` and `~/.pulse-coder/canvas-runtime/` as user runtime data, never repository source of truth.
- Keep `--no-file-parallelism` in test scripts until measured separately. Runtime/CLI suites must mock `homedir` before module import, use per-file temporary homes (never back up or rewrite a live user's runtime descriptor), and use loopback listeners for HTTP stubs.
- The Electron app ships `dist/index.cjs` as an external-agent executable. Keep JS dependencies bundled and ship matching Node/Electron SQLite native assets (`src/core/native-binding.ts`, `scripts/prepare-native.mjs`). Never rebuild a shared pnpm native dependency for another ABI.
- Read `harness/knowledge/storage-concurrency.md` before changing any write path, backend selection, lock, revision check, workspace trash/restore, or file recovery:
  - Preserve store safety: workspace/node id validation, manifest locking, atomic writes, rolling `.bak` recovery, v2 per-node compatibility, and the empty-node wipe guard.
  - Legacy JSON writes must run inside `withWorkspaceLock` (`src/core/store.ts`) and hold the shared migration fence; orphan pruning (`pruneUnknownNodeFiles`) is reserved for restore/repair (`src/core/__tests__/storage-race.test.ts`).
  - Active SQLite writes must preserve original `revision` and `storageGeneration` through read→mutate→commit. Reconcile `__storage__.json` with database activation state and fail closed on missing, damaged, or unsupported active storage.
  - Keep Markdown authoritative: SQL file writes stage recovery intents in the Canvas transaction; `doctor --repair` retries safely and refreshes indexes without overwriting external conflicts or manufacturing missing Markdown from cache.
  - Keep `restore` narrow to legacy v1 snapshots and refuse active SQLite storage.
- Read `README.md` (Commands & Implementation Contracts) before changing CLI flags, output shapes, node capabilities, or runtime commands:
  - Resolve workspaces through `getWorkspaceCommandOptions` (`src/commands/options.ts`; fixed order `--workspace` → `$PULSE_CANVAS_WORKSPACE_ID` → `__workspaces__.json.activeId` → error; pass `{ requireReadableCanvas: false }` for `agent`/`team`/`runtime`/`restore`).
  - Preserve machine-caller contracts: stable `errorOutput` `{ ok, error, code }` on stderr under `--format json` (`setActiveFormat`), `status` non-zero-free pre-flight, and versioned `describe`/`context` (`describeVersion`, `contextVersion`).
  - Preserve node type boundaries (`CreatableNodeType` vs read-only `KnownNodeType` vs opaque `NodeType`), persisted-only reads (`node read` full metadata, `context` prompt-sized excerpts, `--confine-to-workspace` path guard), and `text`/`file`/`frame`/`group` write rules.
  - Live `agent`, `team`, and `runtime` commands must use the runtime file plus bearer auth (`runtime eval` requires `agent-runtime-control` + `webview-page-control`; `runtime host-eval` requires `agent-runtime-control`; neither exposes Electron main/Node APIs). Keep `src/core/runtime-capabilities.ts` non-exiting (`RuntimeClientResult`).
- Changes to command payloads, core exports, node/edge schemas, runtime routes, or storage shape are contract changes; run local validation plus the root `canvas-cli-contract-parity` (`describe-canvas.mjs`) and storage consumer checks when applicable.

## Common Commands

```bash
pnpm --filter @pulse-coder/canvas-cli test
pnpm --filter @pulse-coder/canvas-cli typecheck
pnpm --filter @pulse-coder/canvas-cli build
```

Live `agent`, `team`, and `runtime` smoke checks require a running `apps/canvas-workspace` instance so `~/.pulse-coder/canvas-runtime/canvas-workspace.json` exists.
