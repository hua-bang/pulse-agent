# AGENTS.md - packages/canvas-cli

> Local entry for `packages/canvas-cli`.
> Repository harness entry: `../../harness/README.md`.

## Module Positioning

`@pulse-coder/canvas-cli` owns the agent-facing `pulse-canvas` CLI and programmatic core helpers for Pulse Canvas workspaces. It lets external agents inspect and mutate the local canvas store, install bundled canvas skills, and talk to a running `canvas-workspace` runtime for live agent/team commands.

This package should stay a thin bridge over canvas storage and runtime endpoints. Electron UI behavior belongs in `apps/canvas-workspace`; runtime-loadable plugin node behavior belongs in `packages/canvas-nodes`.

## Knowledge Navigation

| Task | Read |
|---|---|
| Package overview and command UX | `README.md` |
| CLI entrypoint | `src/index.ts`, `src/cli.ts` |
| Command implementations | `src/commands/` |
| Public core exports | `src/core/index.ts` |
| Canvas store and v2 compatibility | `src/core/store.ts`, `src/core/storage-v2.ts` |
| Node, edge, and context behavior | `src/core/nodes.ts`, `src/core/edges.ts`, `src/core/context.ts` |
| Live runtime calls | `src/core/runtime-control.ts`, `src/commands/agent.ts`, `src/commands/team.ts` |
| Bundled agent skills | `skills/` |
| Documentation routing | `../../harness/skills/doc-governance.md` |
| Validation planning | `../../harness/skills/quality-workflow.md` |

## Local Constraints

- Treat `~/.pulse-coder/canvas/` as user runtime data, not repository source of truth.
- Preserve direct-store safety: workspace/node id validation, atomic writes, backups, manifest locking, and v2 per-node storage compatibility.
- Do not make the CLI trigger canvas storage migrations; migration is owned by `apps/canvas-workspace`.
- Live `agent` and `team` commands require the Electron runtime file and bearer secret; do not bypass runtime authentication.
- Changes to command payloads, core exports, or canvas storage shape are contract changes; route them through `../../harness/skills/contract-coding.md`.

## Common Commands

```bash
pnpm --filter @pulse-coder/canvas-cli test
pnpm --filter @pulse-coder/canvas-cli typecheck
pnpm --filter @pulse-coder/canvas-cli build
```

## Key Files

- `src/index.ts`: executable entrypoint for `pulse-canvas`.
- `src/cli.ts`: top-level command registration and global options.
- `src/commands/`: workspace, node, edge, context, agent, team, restore, and skill-install commands.
- `src/core/store.ts`: workspace manifest, canvas load/save, locking, backups, and mutation helpers.
- `src/core/storage-v2.ts`: compatibility layer for layout-only canvas files plus per-node data files.
- `src/core/runtime-control.ts`: live runtime discovery and authenticated POST helper.
- `skills/`: bundled Pulse Canvas skills copied by `install-skills`.
