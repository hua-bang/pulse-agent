# Main Process Structure Audit

Scope: `apps/canvas-workspace/src/main` as observed on 2026-06-14.

This is a document-only architecture audit. It does not propose changing IPC
channel names, renderer API shape, storage locations, or runtime behavior as
part of the audit itself.

## Current Structure

`src/main/index.ts` is already a narrow Electron entrypoint: it resolves the
compiled main directory and delegates to `app/bootstrap.ts`.

The current top-level domains are:

| Area | Current ownership | Approx. non-test LOC | Notes |
| --- | --- | ---: | --- |
| `app/` | Electron lifecycle, window creation, protocol, menu, logging, shell/update IPC, bootstrap sequencing | 836 | `bootstrap.ts` still imports and orders almost every product domain. |
| `canvas/` | Workspace storage, canvas merge/save IPC, v1/v2 migration, broadcast, workspace-node records and tags | 3,507 | `store.ts` and `storage.ts` are the persistence core and largest shared dependency. |
| `agent/` | Canvas agent runtime, session store/send, context building, model/MCP/skills config, prompt profiles, agent tools | 10,707 | Biggest domain; tools reach into canvas, webview, app, artifacts, generation, terminal, settings, and plugins. |
| `agent-teams/` | Team runtime orchestration, team store, canvas node layout, PTY bridge, task verification, handoff/artifact handling | 4,202 | `service.ts` is a mixed coordinator at 2,569 lines. |
| `runtime/` | Loopback runtime-control HTTP server and local MCP server/registration | 1,389 | Routes call agent sessions, team service, canvas storage, and terminal sessions directly. |
| `webview/` | Webview registry, CDP session helpers, DOM/a11y/screenshot reads, operability checks | 657 | Mostly isolated, but agent tools call it directly. |
| `terminal/` | PTY process lifecycle and terminal session APIs | 364 | Used by app bootstrap, agent session send, agent teams, and MCP server. |
| `artifacts/` | Artifact store and artifact-to-canvas pinning IPC | 457 | Depends on canvas store/storage/broadcast. |
| `files/` | File manager IPC, file watcher, skill installer file operations | 608 | Also used by settings install flow. |
| `generation/` | HTML generation and streaming IPC | 197 | Imports agent model config, while agent tools import generation. |
| `settings/` | Built-in tools config and experimental flags | 526 | Experimental IPC delegates to skill installation, so settings has side effects. |

Largest non-test files:

| File | Lines | Primary concern |
| --- | ---: | --- |
| `src/main/agent-teams/service.ts` | 2,569 | Planning, runtime control, heartbeat, validation, verification, canvas sync, and persistence are in one class/module. |
| `src/main/canvas/store.ts` | 1,606 | IPC, merge rules, watchers, migrations, export/import, and startup audit are coupled. |
| `src/main/agent/canvas-agent.ts` | 1,158 | Prompt assembly, model loop, tool streaming, clarification, tracing, and session integration are coupled. |
| `src/main/canvas/storage.ts` | 1,122 | Schema detection, migration, recovery, per-node files, and full canvas read/write APIs are coupled. |
| `src/main/agent/context-builder.ts` | 698 | Workspace summaries, iframe/page reads, storage loading, and prompt formatting are coupled. |
| `src/main/runtime/control-server.ts` | 685 | Server lifecycle, auth, request parsing, runtime file self-healing, and route behavior are coupled. |

## Cross-Domain Dependency Risks

The current folder split is a good first boundary, but several modules still
depend on another domain's internal implementation rather than on a stable
facade.

### 1. `app/bootstrap.ts` is an order-sensitive service registry

`app/bootstrap.ts` imports setup/teardown functions from `terminal`, `canvas`,
`files`, `agent`, `agent-teams`, `settings`, `webview`, `generation`,
`artifacts`, `runtime`, and `plugins/main`.

Risk:

- startup behavior is controlled by one long ordered block;
- small domain changes can accidentally move hidden prerequisites, such as
  applying stored tool/channel config before plugin activation;
- teardown differs by platform and is colocated with setup details;
- tests have to reason about the whole application even when one domain's
  registration changes.

Boundary target:

- keep `app/bootstrap.ts` as Electron lifecycle ownership;
- move domain registration sequencing into an explicit `app/registrations.ts`
  or `app/domain-lifecycle.ts` module with named phases.

### 2. `agent/` directly owns too many canvas persistence details

Examples:

- `agent/context-builder.ts` imports `../canvas/storage`;
- `agent/session-send.ts` imports `../canvas/storage`;
- `agent/tools/_shared/canvas-io.ts` imports `../../../canvas/storage`;
- knowledge/search/tagging/workspace-node tools import `canvas/nodes/*`;
- `agent/ipc.ts` manually reads and writes `canvas.json` in
  `canvas-agent:add-image-to-canvas`.

Risk:

- agent tools can bypass canvas save guards, merge rules, watchers, and
  broadcast contracts;
- canvas storage schema changes require auditing agent internals;
- tool tests need real canvas storage fixtures instead of a smaller port;
- direct file writes make it easy to miss per-node storage or migration rules.

Boundary target:

- expose a canvas application facade for read/write/broadcast operations;
- keep raw storage APIs under `canvas/storage/*` for the canvas domain;
- make agent tools depend on canvas use cases, not storage files.

### 3. `agent/tools/webpage.ts` crosses into webview and app shell

`agent/tools/webpage.ts` imports `webview/registry`, `webview/ensure-operable`,
`webview/reader`, and `app/window-manager`.

Risk:

- agent tool behavior depends on BrowserWindow activation and webContents
  details;
- webview internals become harder to evolve;
- tests for agent tools must account for UI/window state.

Boundary target:

- add a webview capability facade, for example `webview/capabilities.ts`;
- agent tools should call semantic operations such as
  `readNodePageSnapshot()` or `ensureNodePageOperable()`.

### 4. `agent-teams/service.ts` mixes independent subdomains

`agent-teams/service.ts` currently includes:

- plan parsing and dependency graph validation;
- team runtime/store orchestration;
- heartbeat/watchdog and queued-launch recovery;
- task verification command execution;
- human input gates and artifact publishing;
- canvas node update/broadcast integration;
- task dispatch and session health logic.

Risk:

- high change collision surface;
- verification, planning, and heartbeat bugs are hard to isolate;
- canvas layout and team runtime contracts are tangled;
- the class becomes the only realistic integration point for runtime-control,
  IPC, PTY bridge, and tests.

Boundary target:

- keep `CanvasAgentTeamsService` as the public facade;
- split pure planning, verification, watchdog, and canvas-node adapters into
  smaller modules before changing behavior.

### 5. `generation/` and `agent/` form a domain cycle

`generation/html-generator.ts` imports `agent/model/config`, while
`agent/tools/nodes.ts` imports `generation/html-generator`.

Risk:

- model configuration is not actually agent-specific;
- generation cannot be reused without pulling agent internals;
- future model settings changes may create subtle cycles.

Boundary target:

- move shared model resolution into `src/main/model/` or
  `src/main/llm/`;
- keep `agent/model/*` as a compatibility wrapper only during migration.

### 6. `runtime/` directly calls product implementations

`runtime/control-server.ts` calls `agent/session-send` and
`agent-teams/service`. `runtime/mcp-server.ts` calls `terminal/pty-manager` and
`canvas/storage`.

Risk:

- route/auth/server lifecycle code is coupled to feature implementation;
- runtime endpoints become alternate private APIs for domains;
- changing agent-team or terminal internals requires runtime route auditing.

Boundary target:

- split runtime-control into server/auth/request parsing and route adapters;
- inject narrow command ports for agent input and team operations.

### 7. `settings/` includes operational side effects

`settings/experimental-ipc.ts` imports `files/skill-installer`.

Risk:

- settings IPC becomes a feature execution surface rather than configuration
  ownership;
- skill installation changes can regress settings tests and vice versa.

Boundary target:

- keep flag/config reads in `settings/`;
- move installation commands to `files/skill-installer` or a small
  `skills/installer-ipc.ts`, with settings delegating through a stable command.

## Suggested Split Directories

Recommended target shape, preserving current public entrypoints where possible:

```text
src/main/
  app/
    bootstrap.ts
    domain-lifecycle.ts        # ordered domain setup/teardown phases
    registrations.ts           # domain registration list, no feature logic

  canvas/
    service.ts                 # safe canvas use cases for other domains
    repository.ts              # read/write facade over storage
    storage/
      paths.ts
      json.ts
      migration.ts
      per-node.ts
      recovery.ts
      index.ts                 # compatibility exports during migration
    store/
      ipc.ts
      merge.ts
      watchers.ts
      export-import.ts
      startup-audit.ts
    nodes/
      service.ts
      store.ts
      tags.ts
      ipc.ts

  model/                       # or llm/
    config.ts                  # shared model resolution
    ipc.ts                     # only if model settings remain main-wide

  agent/
    runtime/
      canvas-agent.ts
      service.ts
      prompt.ts
      clarification.ts
      tracing.ts
    sessions/
      store.ts
      send.ts
    context/
      builder.ts
      formatter.ts
      readers.ts
    tools/
      registry.ts
      canvas/
      knowledge/
      media/
      web/
      sessions/
      shared/
    ipc.ts                     # preserve existing IPC channel names

  agent-teams/
    planning/
      parse.ts
      graph.ts
      prompts.ts
    runtime/
      service.ts
      heartbeat.ts
      dispatch.ts
      session-health.ts
    verification/
      commands.ts
      results.ts
    canvas/
      nodes.ts
      layout.ts
    store.ts
    ipc.ts

  webview/
    capabilities.ts            # semantic API for agent/runtime callers
    registry.ts
    reader.ts
    ensure-operable.ts
    cdp-session.ts

  runtime/
    control/
      server.ts
      auth.ts
      runtime-file.ts
      routes-agent.ts
      routes-teams.ts
    mcp/
      server.ts
      registration.ts
```

The main migration rule is: keep old exported names available until all
callers move, then remove compatibility wrappers in a separate cleanup.

## Split Points, Migration Order, and Low-Cost Validation

### Split Point 1: bootstrap registration phases

Goal: make `app/bootstrap.ts` own Electron lifecycle while a smaller module
owns domain setup/teardown ordering.

Migration order:

1. Add `app/domain-lifecycle.ts` with named setup phases:
   `setupShell`, `setupStorage`, `setupAgentRuntime`, `setupIntegrations`,
   `setupRuntimeControl`.
2. Move existing calls from `bootstrap.ts` into those phases without changing
   call order.
3. Keep plugin/model/channel ordering explicit in one phase and document the
   prerequisites inline.
4. Move teardown calls into matching teardown helpers.
5. Only after the structure is stable, add tests around setup ordering if
   Electron mocks already exist.

Low-cost validation:

```bash
pnpm typecheck:main
rg "setupCanvasPlugins|applyChannelConfigToEnv|setAgentServiceAccessor" src/main/app
```

### Split Point 2: canvas service facade for non-canvas callers

Goal: stop agent and agent-teams from directly editing canvas storage internals.

Migration order:

1. Add `canvas/service.ts` or `canvas/repository.ts` with safe operations:
   `readCanvas`, `writeCanvas`, `appendNode`, `updateNodes`, `broadcastUpdate`,
   and workspace-node read/write/tag commands.
2. Move `agent/ipc.ts` `canvas-agent:add-image-to-canvas` onto
   `appendNode` so it uses the same storage and broadcast path as canvas.
3. Replace `agent/tools/_shared/canvas-io.ts` internals with the facade while
   preserving its current exports for tools.
4. Move `agent/context-builder.ts`, `agent/session-send.ts`, and
   `agent-teams/canvas-nodes.ts` to the facade.
5. After all callers move, keep raw `canvas/storage` imports limited to
   `canvas/**`, tests, and explicit migration/runtime tools.

Low-cost validation:

```bash
pnpm test -- src/main/__tests__/canvas-storage.test.ts src/main/__tests__/canvas-store-merge.test.ts src/main/__tests__/workspace-node-store.test.ts
pnpm test -- src/main/agent/__tests__/knowledge-tools.test.ts src/main/agent/__tests__/tagging-tools.test.ts src/main/agent/__tests__/tools-graph.test.ts
pnpm typecheck:main
rg "from ['\"]\\.\\./\\.\\./canvas/(storage|store|nodes)|from ['\"]\\.\\./canvas/(storage|store|nodes)" src/main/agent src/main/agent-teams
```

### Split Point 3: agent tool category boundaries

Goal: keep `createCanvasTools` stable while isolating tool groups by capability.

Migration order:

1. Keep `agent/tools/index.ts` or `agent/tools/registry.ts` as the only public
   aggregator.
2. Move canvas layout writers (`nodes`, `edges`, `groups`, `shapes`, `images`)
   under `agent/tools/canvas/`.
3. Move knowledge/tag/search/workspace-node tools under
   `agent/tools/knowledge/`.
4. Move webpage tools under `agent/tools/web/` after the webview facade exists.
5. Move artifacts, skills, sessions, terminal, and visual streaming into
   capability-specific folders.
6. Preserve tool names and input schemas exactly during file moves.

Low-cost validation:

```bash
pnpm test -- src/main/agent/__tests__/tools-graph.test.ts src/main/agent/__tests__/knowledge-tools.test.ts src/main/agent/__tests__/session-tools.test.ts
pnpm typecheck:main
rg "canvas_create_node|workspace_node_list|canvas_read_webpage" src/main/agent/tools
```

### Split Point 4: agent runtime internals

Goal: reduce `agent/canvas-agent.ts` by extracting pure prompt and run-loop
concerns before behavior changes.

Migration order:

1. Extract prompt constants and formatters to `agent/runtime/prompt.ts`.
2. Extract message/tool-call conversion helpers to `agent/runtime/messages.ts`.
3. Extract clarification request bookkeeping to
   `agent/runtime/clarification.ts`.
4. Move debug trace wiring behind `agent/runtime/tracing.ts`.
5. Keep `agent/canvas-agent.ts` as a compatibility export until imports have
   moved to `agent/runtime/canvas-agent.ts`.

Low-cost validation:

```bash
pnpm test -- src/main/agent/__tests__/import.test.ts src/main/agent/__tests__/multi-source.test.ts
pnpm test -- src/main/__tests__/codex-sessions.test.ts src/main/__tests__/agent-session-send.test.ts
pnpm typecheck:main
```

### Split Point 5: agent-teams service decomposition

Goal: preserve `CanvasAgentTeamsService` as facade while splitting planning,
runtime, verification, and canvas adapters.

Migration order:

1. Move pure plan parsing, teammate/task normalization, and dependency graph
   validation into `agent-teams/planning/*`.
2. Move prompt formatting into `agent-teams/planning/prompts.ts`.
3. Move verification command execution and output summarization into
   `agent-teams/verification/*`.
4. Move heartbeat/watchdog/queued-launch recovery into
   `agent-teams/runtime/heartbeat.ts`.
5. Move task dispatch/session health helpers into
   `agent-teams/runtime/dispatch.ts` and `session-health.ts`.
6. Move canvas node creation/layout/update helpers into `agent-teams/canvas/*`.
7. Keep the public service class delegating to these modules until tests and
   callers are stable.

Low-cost validation:

```bash
pnpm test -- src/main/__tests__/agent-teams-service.test.ts src/main/__tests__/agent-team-canvas-nodes.test.ts src/main/agent-teams/__tests__/store.test.ts
pnpm typecheck:main
rg "class CanvasAgentTeamsService|parsePlanDraft|formatLeaderBriefingPrompt|VERIFY_TIMEOUT_MS" src/main/agent-teams
```

### Split Point 6: shared model configuration

Goal: remove the `generation -> agent -> generation` domain cycle.

Migration order:

1. Add `src/main/model/config.ts` and move shared model resolution there.
2. Re-export from `agent/model/config.ts` temporarily so existing agent imports
   continue to work.
3. Update `generation/html-generator.ts` to import from `../model/config`.
4. Update agent runtime and IPC imports to use `../model/config` once stable.
5. Remove the compatibility re-export in a later cleanup.

Low-cost validation:

```bash
pnpm test -- src/main/agent/model/__tests__/config.test.ts
pnpm typecheck:main
rg "from ['\"]\\.\\./agent/model/config|from ['\"]\\.\\./\\.\\./agent/model/config" src/main/generation src/main/agent
```

### Split Point 7: runtime-control route adapters

Goal: keep loopback HTTP lifecycle separate from agent/team command execution.

Migration order:

1. Move runtime file creation, self-healing, and cleanup to
   `runtime/control/runtime-file.ts`.
2. Move bearer-secret parsing and request body parsing to
   `runtime/control/auth.ts` and `request.ts`.
3. Move `/agent/send` behavior to `runtime/control/routes-agent.ts`, depending
   on an injected `sendInputToAgentNode` command.
4. Move team routes to `runtime/control/routes-teams.ts`, depending on an
   injected team-service command port.
5. Keep `runtime/control-server.ts` as a compatibility wrapper until imports
   move to `runtime/control/server.ts`.

Low-cost validation:

```bash
pnpm test -- src/main/runtime/__tests__/control-server.test.ts
pnpm typecheck:main
rg "sendInputToAgentNode|getCanvasAgentTeamsService" src/main/runtime
```

### Split Point 8: settings side-effect isolation

Goal: make settings config-only unless it explicitly delegates to another
domain's command surface.

Migration order:

1. Identify each `settings/*-ipc.ts` handler that performs non-settings work.
2. Move skill installation commands behind `files/skill-installer` exports or
   a dedicated `skills/installer-ipc.ts`.
3. Keep settings IPC focused on reading/writing flags and built-in tool config.
4. Add a narrow adapter function if the renderer needs to trigger installation
   from a settings screen.

Low-cost validation:

```bash
pnpm test -- src/main/settings/__tests__/built-in-tools-config.test.ts
pnpm typecheck:main
rg "skill-installer|runInstall" src/main/settings src/main/files
```

## Boundary Rules To Preserve

- `src/main/index.ts` should stay a thin entrypoint.
- IPC channel names must remain stable during moves.
- Renderer preload/API shape should not change during structural splits.
- Canvas writes should go through one guarded path that handles schema,
  per-node storage, merge protection, and broadcast.
- Domains may depend on stable facades from other domains, but should avoid
  importing another domain's raw storage, IPC handlers, or service singletons.
- Move files first, verify, then split behavior. Avoid behavior changes in the
  same commit as directory migration.

## Recommended First PR Sequence

1. Extract `app/domain-lifecycle.ts` without changing startup order.
2. Add `canvas/service.ts` facade and migrate the most dangerous direct writer:
   `canvas-agent:add-image-to-canvas`.
3. Repoint agent tools' `canvas-io` wrapper to the canvas facade.
4. Extract pure planning helpers from `agent-teams/service.ts`.
5. Move shared model config to `src/main/model/config.ts`.

These steps shrink the highest-risk files and remove the most expensive domain
cycles without requiring renderer changes.
