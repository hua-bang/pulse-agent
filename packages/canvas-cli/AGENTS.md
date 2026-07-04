# AGENTS.md - packages/canvas-cli

> Local entry for `packages/canvas-cli`.
> Repository harness entry: `../../harness/README.md`.

## Module Positioning

`@pulse-coder/canvas-cli` owns the `pulse-canvas` command-line surface and the
`@pulse-coder/canvas-cli/core` helpers for external agents that need to inspect
or mutate Pulse Canvas workspaces.

Most commands operate directly on the canvas store under
`~/.pulse-coder/canvas/`: workspace manifests, per-workspace `canvas.json`,
edges, nodes, backups, and v2 per-node files. The `agent` and `team` command
families are different: they require a running `apps/canvas-workspace` instance
and call its loopback runtime-control server using the bearer secret advertised
in `~/.pulse-coder/canvas-runtime/canvas-workspace.json`.

Keep this package a thin bridge over store files and runtime endpoints. The
Electron UI, active PTY lifecycle, storage migration, and runtime server belong
in `apps/canvas-workspace`; runtime-loadable plugin node behavior belongs in
`packages/canvas-nodes`.

## Knowledge Navigation

| Task | Read |
|---|---|
| Repository harness and root validation | `../../harness/README.md`, `../../harness/validate/validation.yaml` |
| Package overview and install flow | `README.md` |
| Current CLI command index | `src/cli.ts` |
| Executable entrypoint | `src/index.ts` |
| Workspace/node/edge/context commands | `src/commands/workspace.ts`, `src/commands/node.ts`, `src/commands/edge.ts`, `src/commands/context.ts` |
| Live runtime commands | `src/commands/agent.ts`, `src/commands/team.ts`, `src/core/runtime-control.ts` |
| v2 recovery command | `src/commands/restore.ts` |
| Public core exports | `src/core/index.ts` |
| Store safety and schema compatibility | `src/core/store.ts`, `src/core/storage-v2.ts`, `src/core/types.ts`, `src/core/constants.ts` |
| Node and edge behavior | `src/core/nodes.ts`, `src/core/edges.ts` |
| Bundled agent skills | `skills/`, `src/commands/install-skills.ts` |
| Tests | `src/core/__tests__/`, `src/commands/__tests__/` |
| Local validation | `harness/validate/validation.yaml` |

There is no package-local documentation beyond the local validation file. Use
the root harness files above, then the package source/tests.

## Local Constraints

- Treat `~/.pulse-coder/canvas/` and `~/.pulse-coder/canvas-runtime/` as user
  runtime data, never repository source of truth.
- Preserve store safety: workspace/node id validation, manifest locking,
  atomic writes, rolling `.bak` recovery, v2 per-node compatibility, and the
  guard that refuses accidental empty-node overwrites.
- Do not make this CLI trigger v2 migrations. `canvas-workspace` owns
  migration; the CLI adapts to the on-disk schema it finds.
- Keep `restore` narrow: it recovers from v1 snapshots and archives live
  `nodes/` data so the app can migrate cleanly later; it is not a general
  migration tool.
- `node create` supports `file`, `terminal`, `frame`, `group`, `agent`, and
  `mindmap`. Terminal/agent nodes created by the CLI have no active PTY session.
- `reference` is a read-compatible node shape in core types, but not a CLI
  creation type. Plugin nodes are handled through the Canvas host/plugin tools,
  not by this package's generic `node create`.
- Live `agent` and `team` commands must keep using the runtime file plus bearer
  auth. Do not bypass runtime authentication or reach into Electron memory from
  this package.
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
runtime file exists; otherwise `pulse-canvas agent ...` and
`pulse-canvas team ...` are expected to fail with "No active
canvas-workspace runtime found."

## Key Files

- `src/index.ts`: executable entrypoint for `pulse-canvas`.
- `src/cli.ts`: top-level command registration and global options.
- `src/commands/`: workspace, node, edge, context, agent, team, restore, and
  skill-install commands.
- `src/core/store.ts`: workspace manifests, canvas load/save, locks, backups,
  wipe guard, and node/edge mutation commits.
- `src/core/storage-v2.ts`: compatibility layer for layout-only `canvas.json`
  plus `nodes/<nodeId>.json`.
- `src/core/nodes.ts`: node read/write/create/delete behavior and node
  capability mapping.
- `src/core/edges.ts`: edge create/list/delete behavior.
- `src/core/runtime-control.ts`: runtime discovery and authenticated POST helper.
- `skills/`: bundled Pulse Canvas skills copied by `install-skills`.
