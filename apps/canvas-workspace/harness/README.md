# Canvas Workspace Harness

This directory is the workspace-local harness container for `canvas-workspace`.
Keep it as a router for durable local harness assets.

## Areas

| Area | Path | Purpose |
|---|---|---|
| UI spec | `spec/ui/` | Workspace-local UI consistency, composition, token, and reuse rules. |
| Runtime tool | `tools/runtime/` | Electron launch, CDP inspection, screenshots, UI operations, logs, and cleanup. |
| UI audit tool | `tools/ui-audit/` | Lightweight renderer CSS/TSX drift inventory for UI consistency work. |
| Validate | `validate/validation.yaml` | Local path-to-command validation rules for this workspace. |
| Local protocol docs | `../skills/canvas-harness/`, `../skills/canvas-onboard-harness/` | Markdown workflows linked from `AGENTS.md`; not the repo-level harness Skills registry. |

## Runtime Entry

Use the package script so callers do not depend on the tool's internal path:

```bash
pnpm --filter canvas-workspace harness start --profile demo --build
pnpm --filter canvas-workspace harness status
pnpm --filter canvas-workspace harness screenshot
pnpm --filter canvas-workspace harness close --cleanup
```

See `tools/runtime/README.md` for the full runtime command set and profile
semantics.

## UI Consistency

Read `spec/ui/README.md` before adding or changing shared UI surfaces. Run the
lightweight audit when UI-facing CSS/TSX changes:

```bash
node apps/canvas-workspace/harness/tools/ui-audit/cli.mjs
```
