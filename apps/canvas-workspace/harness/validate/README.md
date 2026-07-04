# Canvas Workspace Validate

Run commands from the repository root.

## Default Checks

For `src/**` and TypeScript config changes:

```bash
pnpm --filter canvas-workspace typecheck
pnpm --filter canvas-workspace test
```

For package/build configuration changes, add the build:

```bash
pnpm --filter canvas-workspace build
```

## UI Checks

For UI-facing CSS/TSX changes or changes to the UI spec/tool:

```bash
node apps/canvas-workspace/harness/tools/ui-audit/cli.mjs
```

This is an inventory check, not a hard quality gate yet. It reports likely token
and surface drift so the change can be reviewed against `harness/spec/ui/README.md`.

## Runtime Harness Checks

For changes under `harness/tools/runtime/**` or the linked canvas harness
protocol docs:

```bash
node apps/canvas-workspace/harness/tools/runtime/cli.mjs self-check
```

Use the Electron runtime harness only when the change affects app startup,
preload/main bootstrap, visual behavior, screenshots, or interaction-heavy
flows:

```bash
pnpm --filter canvas-workspace harness start --profile demo --reset --force --build --json
pnpm --filter canvas-workspace harness status --json
pnpm --filter canvas-workspace harness snapshot-ui --json
pnpm --filter canvas-workspace harness screenshot --method cdp --json
pnpm --filter canvas-workspace harness close --cleanup
```

## Docs-Only Changes

Docs-only or routing-only changes do not require app build/test by default.
Check referenced paths and commands, and run the root graph viewer smoke when
the harness routing files change:

```bash
node harness/tools/graph-viewer/server.mjs --once
```

## Root Overlay

Start with this workspace validation file for canvas-local changes. Use the
root `harness/validate/validation.yaml` only for root config changes or
cross-workspace impact such as engine public API, agent-teams protocol, or
plugin-kit contract changes.
