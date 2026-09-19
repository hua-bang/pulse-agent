# AGENTS.md - packages/canvas-cli

> Local entry for `packages/canvas-cli`.
> Repository harness entry: `../../harness/README.md`.

## Module Positioning

`@pulse-coder/canvas-cli` owns the `pulse-canvas` command-line surface and the
`@pulse-coder/canvas-cli/core` helpers for external agents that need to inspect
or mutate Pulse Canvas workspaces.

Most commands operate on the local canvas store under `~/.pulse-coder/canvas/`
without a running app. Unactivated stores retain v1/v2 JSON; database-owned
activation selects the shared SQLite adapter for the `canvas` domain. Markdown,
attachments, and the workspace manifest remain files. The `agent`, `team`, and `runtime`
command families are different: they require a running `apps/canvas-workspace` instance
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
| Atomic batch mutation from a plan file | `src/commands/apply.ts`, `src/core/apply.ts` |
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

- Treat `~/.pulse-coder/canvas/` and `~/.pulse-coder/canvas-runtime/` as user
  runtime data, never repository source of truth.
- Keep the existing `--no-file-parallelism` test entry until changing it is
  measured separately. Runtime/CLI suites mock homedir before module import
  and use per-file temporary homes; never back up or rewrite a live user's
  runtime descriptor as test setup. Their HTTP stubs need loopback listeners.
- The Electron app ships `dist/index.cjs` as an external-agent executable. Keep
  JavaScript dependencies bundled and ship the matching Node/Electron SQLite
  native assets. Never rebuild a shared pnpm native dependency for another ABI.
  `src/core/native-binding.ts` and `scripts/prepare-native.mjs` own resolution
  and the Node asset; the app prepares its isolated Electron asset.
- Preserve store safety: workspace/node id validation, manifest locking,
  atomic writes, rolling `.bak` recovery, v2 per-node compatibility, and the
  guard that refuses accidental empty-node overwrites.
- Every canvas write runs inside `withWorkspaceLock` (store.ts): full
  load→mutate→save cycles must hold the per-workspace lock
  (`<storeRoot>/__locks__/<id>.lock`), and v2 saves delete per-node files
  only for ids the mutation explicitly removed — the full-sync sweep
  (`pruneUnknownNodeFiles`) is reserved for restore/repair flows. Both rules
  exist because parallel CLI writers used to drop and even delete each
  other's nodes; regression suite: `src/core/__tests__/storage-race.test.ts`.
  These file-lock and `updatedAt` arbitration rules remain for legacy stores;
  active SQLite writes use shared transactions and conditional revisions.
- For SQLite, preserve the original `revision` AND `storageGeneration` through
  read→mutation→commit. Never stamp an old node or canvas with a later read's
  revision. In legacy JSON, `revision` still counts CLI writes only. Prefer one
  `apply` plan for a batch; do not claim filesystem effects are a DB transaction.
- The app owns activation. Reconcile `__storage__.json` with the database's
  activation state before selecting Canvas's backend; a staging database or
  another active domain is insufficient. Missing,
  damaged, or unsupported active storage must fail closed, never fall back to
  old JSON. Legacy writes must hold the shared migration fence. Details and
  first-upgrade guards: `harness/knowledge/storage-concurrency.md`.
- Keep Markdown authoritative and externally editable. SQL file writes stage
  recovery intents in the Canvas transaction; incomplete writes fail with an
  intent id and retain recovery snapshots. `doctor --repair` retries safely and
  refreshes indexes from files; it must not overwrite external conflicts or
  manufacture missing Markdown from a cached index.
- Keep `restore` narrow: it recovers from v1 snapshots and archives live
  `nodes/` data so the app can migrate cleanly later; it is not a general
  migration tool and must refuse an active SQLite canvas backend.
- Node types split into `CreatableNodeType` (what `node create` accepts:
  `file`, `terminal`, `frame`, `group`, `agent`, `mindmap`) and the wider
  `KnownNodeType` read set (`text`, `iframe`, `image`, `shape`, `reference`,
  `dynamic-app`, `plugin`). `NodeType = KnownNodeType | (string & {})` so a
  future node type from a newer app still loads and reads as an opaque node
  rather than breaking `loadCanvas`. Terminal/agent nodes created by the CLI
  have no active PTY session.
- The read-only types are surfaced by `readNode`/`context` from persisted
  `data` only — never by fetching the network or reaching into Electron. `node
  read` returns full metadata; `context` excerpts `text` and omits heavy fields
  (iframe `html`/`prompt`, plugin `payload`) to stay prompt-sized. Reading a
  live URL-iframe page body is explicitly out of scope for `node read` — it
  is available only through the runtime-authenticated capability client.
- `reference` and plugin nodes are read-compatible shapes, not CLI creation
  types. Plugin nodes are authored through the Canvas host/plugin tools, not
  this package's generic `node create`.
- `text` nodes are read+write (their markdown lives inline in `data.content`);
  `node write` edits them. Other app-produced types stay read-only.
- Error contract (machine callers): `errorOutput` emits `{ ok, error, code }`
  JSON on stderr under `--format json` (human `Error:` line otherwise); the
  format is set once by the cli.ts `preAction` hook via `setActiveFormat`. Core
  `Result` failures carry an optional `code`; command layer forwards it. Keep
  `code` values stable — external callers branch on them. New error sites should
  pass a `code`.
- `--confine-to-workspace` restricts `file`-node disk paths (from a possibly
  untrusted canvas.json) to the workspace dir: reads fall back to in-memory
  content (`pathConfined: true`), writes fail with `path_confined`. The guard is
  opt-in so existing app-created nodes (paths under `notes/`) are unaffected.
- External-caller surface: `status` (non-fatal store/workspace/runtime probe —
  never exits non-zero for "no workspace") and `describe` (self-describing
  manifest with `describeVersion`) exist so agents can pre-flight and plan.
  `context` output carries `contextVersion`; bump it (and `describeVersion`) on
  any breaking shape change. `node read` takes multiple ids (single → object,
  many → array with per-id error entries); `node search`/`node list --type`/
  `context --types` cut round-trips; `node update` owns layout/title (not data).
  Keep these output shapes and their version fields stable.
- Live `agent` and `team` commands must keep using the runtime file plus bearer
  auth. Do not bypass runtime authentication or reach into Electron memory from
  this package.
- Live `runtime` commands use the same authenticated client. The two external
  `unsafe` exceptions are `runtime eval` (`browser.page.eval`, requiring both
  `agent-runtime-control` and `webview-page-control`, executes in a selected
  guest page) and `runtime host-eval` (`host.renderer.eval`, requiring
  `agent-runtime-control`, executes in the selected workspace's host renderer).
  Neither path exposes Electron main or Node APIs.
- `src/core/runtime-capabilities.ts` is the non-exiting client for experimental
  live-app capabilities. Keep its structured `RuntimeClientResult` contract so
  agent hosts can treat a missing/disabled Canvas runtime as a tool result, not
  a process exit.
- New commands resolve their workspace through `getWorkspaceCommandOptions`
  (`src/commands/options.ts`), not by reading `opts.workspace` directly. The
  fixed discovery order is `--workspace` → `$PULSE_CANVAS_WORKSPACE_ID` →
  `__workspaces__.json.activeId` → hard error; it never guesses (no
  "most recent" / "first in list"). Local commands require a readable canvas
  in the selected backend; SQL workspaces need no `canvas.json`.
  Runtime-mediated (`agent`/`team`/`runtime`) and `restore` pass
  `{ requireReadableCanvas: false }` since the workspace lives in the app or is
  the thing being recovered.
- Changes to command payloads, core exports, node/edge schemas, runtime routes,
  or storage shape are contract changes; use local validation plus the root
  impact overlay when hosts are affected.

## Common Commands

```bash
pnpm --filter @pulse-coder/canvas-cli test
pnpm --filter @pulse-coder/canvas-cli typecheck
pnpm --filter @pulse-coder/canvas-cli build
```

For runtime command smoke checks, first run/build the Electron app so the
runtime file exists; otherwise `pulse-canvas agent ...`,
`pulse-canvas team ...`, and `pulse-canvas runtime ...` are expected to fail
with "No active canvas-workspace runtime found."

## Key Files

- `src/index.ts`: executable entrypoint for `pulse-canvas`.
- `src/cli.ts`: top-level command registration and global options.
- `src/commands/`: workspace, node, edge, context, agent, team, runtime,
  restore, and skill-install commands.
- `src/core/doctor.ts`: backend-aware diagnostics; legacy repair adopts orphan
  files, while `sqlite-doctor.ts` handles intents, integrity, and source-file
  index reconciliation. CLI face in
  `src/commands/doctor.ts`.
- `src/core/layout.ts`: geometry summary, layout validation (overlaps, frame
  containment, readability, aspect ratio), and frame-grid arrangement;
  containment is geometric (smallest frame holding a node's center). CLI face
  in `src/commands/layout.ts`.
- `src/core/apply.ts`: validate a complete plan before mutation; SQLite commits
  graph changes and file intents together, then recovers files. Legacy writes
  retain their file flow. CLI face in `src/commands/apply.ts`.
- `src/core/store.ts`: workspace manifests, canvas load/save, locks, backups,
  wipe guard, and node/edge mutation commits.
- `src/core/storage-v2.ts`: compatibility layer for layout-only `canvas.json`
  plus `nodes/<nodeId>.json`.
- `src/core/nodes.ts`: node read/write/create/delete behavior and node
  capability mapping.
- `src/core/edges.ts`: edge create/list/delete behavior.
- `src/core/runtime-control.ts`: runtime discovery and authenticated POST helper.
- `src/core/runtime-capabilities.ts`: authenticated capability discovery/call
  client for external agent hosts.
- `skills/`: bundled Pulse Canvas skills copied by `install-skills`.
