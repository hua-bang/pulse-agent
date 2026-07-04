# Canvas Workspace Harness

This directory is the workspace-local harness container for `canvas-workspace`.
Keep it as a router for durable local harness assets.

## Areas

| Area | Path | Purpose |
|---|---|---|
| Runtime tool | `tools/runtime/` | Electron launch, CDP inspection, screenshots, UI operations, logs, and cleanup. |
| Validate | `validate/validation.yaml` | Local path-to-command validation rules for this workspace. |

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
