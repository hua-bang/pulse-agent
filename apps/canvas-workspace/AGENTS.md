# AGENTS.md - apps/canvas-workspace

> Local entry for `apps/canvas-workspace`.
> Repository harness entry: `../../harness/README.md`.
> `CLAUDE.md` is a thin import shell of this file — edit here, never both.

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
existing workspace docs or tests. Add new workspace docs only when a behavior
or operating runbook needs a durable source of truth.

**Local harness layout** — `harness/` is this workspace's repo-harness
container, aligned with `packages/engine/harness/` (migrated 2026-07-07;
before that the directory held only the Electron driver):
- `harness/knowledge/` — conventions, main domain map, renderer surfaces,
  plugin node contract, security posture, known defects (moved from `docs/`;
  `docs/` now keeps only project records like perf analyses and roadmaps).
- `harness/tools/driver/` — the headless-Electron driver (launch profiles,
  CDP, screenshots, logs). It is BOTH the repo-harness Tool face and a
  product-operation CLI; `pnpm --filter canvas-workspace harness <cmd>`
  still points at it.
- `harness/tools/describe-canvas.mjs` — static structure snapshot: agent-tool
  registry (45), IPC handle↔invoke contract diff, node-type union↔factory
  sync. Run before touching any of those registries; exits non-zero on a
  broken invoke or union/factory drift.
- `harness/skills/` — SKILL.md procedures for coding agents operating this
  app (`canvas-harness`, `canvas-onboard-harness`, `add-canvas-node`).
- `harness/spec/` — decision-pending intent, currently **empty** (the
  success state). Two entries completed their full lifecycle: UI-reuse
  (2026-07-07: decided → mechanized as `ui-reuse-governance.test.ts` +
  `components/ui/` → deleted) and node-extension-path (2026-07-08: decided
  plugin-default → encoded in the `add-canvas-node` skill + this file's
  node-type constraint above → deleted). Surface definition lives in
  `packages/engine/harness/spec/README.md`.
- `harness/validate/validation.yaml` — path→check bindings for the repo runner.

**"skills" disambiguation** — `harness/skills/*/SKILL.md` are procedures for
CODING agents working on this app; `src/main/agent/skills/` is the PRODUCT
runtime-skills feature of the in-app Canvas Agent; `files/skill-installer.ts`
installs the latter. Do not mix them.

## Knowledge Navigation

| Task | Read |
|---|---|
| Repository harness and root validation | `../../harness/README.md`, `../../harness/validate/validation.yaml` |
| App overview | `README.md` |
| Drive the real app (launch/CDP/screenshot) | `harness/tools/driver/README.md`, `harness/skills/canvas-harness/SKILL.md`, `harness/skills/canvas-onboard-harness/SKILL.md`; what "correct" looks like: `harness/knowledge/renderer-surfaces.md` |
| Security posture, agent execution reach, disk/config surfaces | `harness/knowledge/security-posture.md` |
| Confirmed-but-unfixed defects | `harness/knowledge/known-defects.md` |
| Main/renderer/preload boundaries | `harness/knowledge/conventions/README.md`, `harness/knowledge/conventions/architecture-boundaries.md` |
| Renderer conventions | `harness/knowledge/conventions/frontend.md` |
| Main-process conventions | `harness/knowledge/conventions/backend.md` |
| Main domain map | `harness/knowledge/main-domain-modules.md`, `src/main/index.ts`, `src/main/app/bootstrap.ts` |
| Renderer routes and full-app surfaces | `harness/knowledge/renderer-surfaces.md`, `src/renderer/src/App.tsx`, `src/renderer/src/components/Workbench/`, `src/renderer/src/components/RightDock/` |
| Cross-process API bridge | `src/preload/index.ts`, `src/preload/bridge/`, `src/renderer/src/types.ts`, `src/shared/` |
| Canvas node/edge schema | `src/shared/canvas.ts` |
| Add a new canvas node capability | `harness/skills/add-canvas-node/SKILL.md` (ordered procedure — plugin is the default path, host type is the exception); background: `harness/knowledge/plugin-node-mf2.md` (plugin path), `src/shared/canvas.ts`, `src/renderer/src/utils/nodeFactory.ts`, `src/renderer/src/components/CanvasNodeView/` (host-type touch points) |
| Current registries (agent tools / IPC pairs / node types) | run `node harness/tools/describe-canvas.mjs` (from this dir; `--json` for machines) |
| Canvas persistence and migration | `src/main/canvas/store.ts`, `src/main/canvas/storage.ts`, `src/main/canvas/nodes/` (NB: `nodes/` here = knowledge-node records + tags, NOT node types) |
| Canvas Agent and tools | `src/main/agent/`, `src/main/agent/tools/`, `src/renderer/src/components/chat/` |
| Agent teams | `src/main/agent-teams/`, `src/renderer/src/components/AgentTeamFrame/` |
| Runtime-control server | `src/main/runtime/control-server.ts` |
| Plugin node contract | `harness/knowledge/plugin-node-mf2.md`, `src/plugins/types.ts`, `src/plugins/main/`, `src/plugins/renderer/`, `src/plugins/mock-node/` |
| Project records (perf analyses, roadmaps) | `docs/` |
| Channel plugin | `src/plugins/main/channel/README.md`, `src/plugins/main/channel/` |
| Boundary, file-size, and UI-reuse gates | `src/main/__tests__/import-boundaries.test.ts`, `src/main/__tests__/file-size-governance.test.ts`, `src/main/__tests__/ui-reuse-governance.test.ts` |
| Storage/plugin/runtime tests | `src/main/__tests__/canvas-storage.test.ts`, `src/plugins/main/__tests__/registry.test.ts`, `src/main/runtime/__tests__/control-server.test.ts` |
| Local validation | `harness/validate/validation.yaml` |

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
- Runtime data belongs under user locations such as `~/.pulse-coder/canvas/`,
  `~/.pulse-coder/canvas-runtime/`, and model/settings files. Do not write user
  runtime state into the repository.
- `harness/tools/driver/` launches the real Electron app. Use `temp`, `demo`,
  or `clone` profiles by default; use `real --allow-real-writes` only after
  explicit user intent because it can mutate real Pulse Canvas data.
- The app owns v2 canvas storage migration, PTY sessions, runtime-control
  endpoints, plugin activation, and UI-visible data recovery. The CLI adapts to
  those contracts but does not own them.
- Canvas node and edge shapes are sourced from `src/shared/canvas.ts`, not the
  shorter README node table. Current host node types include `file`,
  `terminal`, `frame`, `group`, `agent`, `text`, `iframe`, `image`, `shape`,
  `mindmap`, `reference`, `dynamic-app`, and `plugin`.
- Plugin nodes use stable host type `plugin` with plugin-owned
  `data.payload`. **New node capabilities default to plugin nodes** (decided
  2026-07-08); extending the host `CanvasNode['type']` union is the
  exception, reserved for nodes needing main-process integration the plugin
  capability registry can't cover (a persistent session/IPC channel like
  PTY, or a dedicated storage-migration path) — see
  `harness/skills/add-canvas-node/SKILL.md`.
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
- `harness/`: workspace harness container — `knowledge/` (conventions + maps),
  `tools/driver/` (Electron launch, CDP, screenshot, input, logs, cleanup),
  `skills/` (agent procedures), `validate/` (check bindings).
