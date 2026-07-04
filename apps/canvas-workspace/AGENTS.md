# AGENTS.md - apps/canvas-workspace

> Local entry for `apps/canvas-workspace`.
> Repository harness entry: `../../harness/README.md`.
> Claude Code specific guidance lives in `CLAUDE.md`.

## Module Positioning

`canvas-workspace` owns the Pulse Canvas Electron workbench: the desktop shell,
React renderer, preload bridge, canvas persistence and migration, Canvas Agent
chat, agent-team flows, plugin loading, embedded webviews, terminal/agent PTYs,
artifacts, settings, local runtime-control server, and app-specific harness.

This is an active pnpm app workspace. It consumes `pulse-coder-engine` and
`pulse-coder-agent-teams`, interoperates with `@pulse-coder/canvas-cli` through
the canvas store and runtime-control server, and hosts external node plugins
such as `@pulse-canvas/nodes` through manifests and plugin registries.

Keep this file as the local router. Put durable implementation detail in
`CLAUDE.md`, existing workspace docs, or tests. Add new workspace docs only
when a behavior or operating runbook needs a durable source of truth.

## Knowledge Navigation

| Task | Read |
|---|---|
| Repository harness and root validation | `../../harness/README.md`, `../../harness/validate/validation.yaml` |
| App overview and Claude-specific notes | `README.md`, `CLAUDE.md` |
| Runtime harness | `harness/README.md`, `harness/tools/runtime/README.md`, `skills/canvas-harness/SKILL.md`, `skills/canvas-onboard-harness/SKILL.md` |
| Main/renderer/preload boundaries | `docs/conventions/README.md`, `docs/conventions/architecture-boundaries.md` |
| Renderer conventions | `docs/conventions/frontend.md` |
| UI consistency and component reuse | `harness/spec/ui/README.md`, `docs/conventions/frontend.md`, `docs/renderer-surfaces.md`, `src/renderer/src/styles.css` |
| Main-process conventions | `docs/conventions/backend.md` |
| Main domain map | `docs/main-domain-modules.md`, `src/main/index.ts`, `src/main/app/bootstrap.ts` |
| Renderer routes and full-app surfaces | `docs/renderer-surfaces.md`, `src/renderer/src/App.tsx`, `src/renderer/src/components/Workbench/`, `src/renderer/src/components/RightDock/` |
| Cross-process API bridge | `src/preload/index.ts`, `src/preload/bridge/`, `src/renderer/src/types.ts`, `src/shared/` |
| Canvas node/edge schema | `src/shared/canvas.ts` |
| Canvas persistence and migration | `src/main/canvas/store.ts`, `src/main/canvas/storage.ts`, `src/main/canvas/nodes/` |
| Canvas Agent and tools | `src/main/agent/`, `src/main/agent/tools/`, `src/renderer/src/components/chat/` |
| Agent teams | `src/main/agent-teams/`, `src/renderer/src/components/AgentTeamFrame/` |
| Runtime-control server | `src/main/runtime/control-server.ts` |
| Plugin node contract | `docs/plugin-node-mf2.md`, `src/plugins/types.ts`, `src/plugins/main/`, `src/plugins/renderer/`, `src/plugins/mock-node/` |
| Channel plugin | `src/plugins/main/channel/README.md`, `src/plugins/main/channel/` |
| Boundary and file-size gates | `src/main/__tests__/import-boundaries.test.ts`, `src/main/__tests__/file-size-governance.test.ts` |
| Storage/plugin/runtime tests | `src/main/__tests__/canvas-storage.test.ts`, `src/plugins/main/__tests__/registry.test.ts`, `src/main/runtime/__tests__/control-server.test.ts` |
| Local validation | `harness/validate/README.md`, `harness/validate/validation.yaml` |

## Local Constraints

- Renderer code reaches privileged behavior only through the typed
  `window.canvasWorkspace` preload API. Do not import Electron, Node, `src/main`,
  or `src/preload` from renderer code.
- Cross-process contracts should move toward `src/shared/`. Existing preload
  imports from `src/renderer/src/types.ts` are allowlisted migration debt; do
  not add new preload-to-renderer imports.
- Keep main-process code in domain folders under `src/main/`; preserve
  IPC channel names and preload API shape when refactoring.
- Follow file-size governance: new production `.ts`/`.tsx` files must stay at
  or below 500 lines, and existing over-500 baseline files must not grow.
- For UI-facing work, read `harness/spec/ui/README.md` first. Reuse existing
  workbench surfaces and semantic tokens before adding new containers, colors,
  shadows, radii, or layer values.
- Runtime data belongs under user locations such as `~/.pulse-coder/canvas/`,
  `~/.pulse-coder/canvas-runtime/`, and model/settings files. Do not write user
  runtime state into the repository.
- `harness/tools/runtime/` launches the real Electron app. Use `temp`, `demo`, or `clone`
  profiles by default; use `real --allow-real-writes` only after explicit user
  intent because it can mutate real Pulse Canvas data.
- `skills/canvas-harness/` and `skills/canvas-onboard-harness/` are local
  Markdown workflow docs linked from this router; they are not the repo-level
  harness Skills registry.
- The app owns v2 canvas storage migration, PTY sessions, runtime-control
  endpoints, plugin activation, and UI-visible data recovery. The CLI adapts to
  those contracts but does not own them.
- Canvas node and edge shapes are sourced from `src/shared/canvas.ts`, not the
  shorter README node table. Current host node types include `file`,
  `terminal`, `frame`, `group`, `agent`, `text`, `iframe`, `image`, `shape`,
  `mindmap`, `reference`, `dynamic-app`, and `plugin`.
- Plugin nodes use stable host type `plugin` with plugin-owned
  `data.payload`. Host behavior should go through renderer/main plugin
  registries and declared capabilities.
- The channel plugin is inert unless the experimental flag and channel config
  are enabled; keep channel credentials in local settings/env, not source.

## Common Commands

```bash
pnpm --filter canvas-workspace typecheck
pnpm --filter canvas-workspace test
pnpm --filter canvas-workspace build
pnpm --filter canvas-workspace dev
pnpm --filter canvas-workspace dev:temp-home
```

Harness commands for interaction-heavy or visual changes:

```bash
pnpm --filter canvas-workspace harness start --profile demo --build
pnpm --filter canvas-workspace harness status
pnpm --filter canvas-workspace harness snapshot-ui
pnpm --filter canvas-workspace harness screenshot
pnpm --filter canvas-workspace harness logs --lines 120
pnpm --filter canvas-workspace harness close --cleanup
```

Lightweight UI consistency inventory:

```bash
node apps/canvas-workspace/harness/tools/ui-audit/cli.mjs
```

Packaging commands exist, but are slower and platform-dependent:

```bash
pnpm --filter canvas-workspace package
pnpm --filter canvas-workspace package:mac
pnpm --filter canvas-workspace package:mac:arm64
pnpm --filter canvas-workspace package:win
pnpm --filter canvas-workspace package:linux
```

## Key Files

- `src/main/index.ts`: thin Electron main entrypoint.
- `src/main/app/bootstrap.ts`: startup wiring for IPC, canvas storage, agent,
  teams, plugins, runtime-control, window creation, and teardown.
- `src/preload/index.ts`: exposes `window.canvasWorkspace` and assembles bridge
  APIs.
- `src/renderer/src/App.tsx`: top-level renderer routes, shell, settings, and
  plugin route/nav integration.
- `src/renderer/src/components/Canvas/`: canvas surface and interaction wiring.
- `src/renderer/src/components/Workbench/`: mounted workspace state and chat
  portal ownership.
- `src/renderer/src/components/RightDock/`: tabbed right dock for chat and
  previews.
- `src/shared/canvas.ts`: canonical canvas node, edge, reference, and workspace
  node contracts.
- `src/main/canvas/store.ts`: workspace manifest/store IPC, watchers, export,
  import, and migration hooks.
- `src/main/canvas/storage.ts`: atomic JSON I/O, v2 split storage, migration,
  recovery, and pollution detection.
- `src/main/agent/`: Canvas Agent service, session store, prompt/model config,
  tools, and chat IPC.
- `src/main/agent-teams/`: agent-team service, store, IPC, PTY bridge, and
  canvas node integration.
- `src/main/runtime/control-server.ts`: loopback runtime server used by live
  `pulse-canvas` commands.
- `src/plugins/main/`, `src/plugins/renderer/`, `src/plugins/types.ts`: Canvas
  plugin registries and shared plugin contracts.
- `harness/`: workspace harness container for local tools and validation.
- `harness/spec/ui/`: workspace-local UI consistency and component reuse spec.
- `harness/validate/`: local validation guidance and path-to-command rules.
- `harness/tools/ui-audit/`: lightweight renderer UI drift inventory.
- `harness/tools/runtime/`: app-specific Electron launch, CDP, screenshot,
  input, logs, and cleanup harness.
