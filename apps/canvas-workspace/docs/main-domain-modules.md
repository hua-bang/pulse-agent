# Main Process Domain Modules

Status: domain move complete; follow-up splits documented below.

This document describes the target shape for `src/main`. The main process has
grown from a small Electron entrypoint into a set of independent product
capabilities: canvas persistence, canvas agent, artifacts, embedded webviews,
terminal sessions, filesystem helpers, generation, and runtime control.

The flat root layout has been moved to domain-owned modules while preserving
existing behavior. Follow-up work can split the remaining large files inside
those domains.

## Principles

- Prefer domain folders over technical buckets.
- Keep IPC handlers inside the domain they expose.
- Keep Electron app lifecycle code separate from product capability code.
- Move files first, then split large files after imports and tests are stable.
- Preserve IPC channel names and preload API shape during structural moves.
- Avoid broad `services/`, `utils/`, or top-level `ipc/` folders unless a file
  is genuinely shared across domains.

## Target Structure

```text
src/main/
  index.ts

  app/
    bootstrap.ts
    window.ts
    protocol.ts
    link-policy.ts
    logging.ts
    shell-ipc.ts

  canvas/
    store.ts
    storage.ts
    broadcast.ts
    nodes/
      ipc.ts
      store.ts
      tags.ts

  agent/
    ipc.ts
    session-send.ts
    canvas-agent.ts
    service.ts
    types.ts
    context/
    debug/
    model/
    sessions/
    tools/
    workspace-doc-generator.ts
    workspace-meta.ts

  artifacts/
    ipc.ts
    store.ts
    pin-to-canvas.ts

  webview/
    registry.ts
    reader.ts
    cdp-session.ts

  terminal/
    pty-manager.ts

  files/
    manager.ts
    watcher.ts
    skill-installer.ts

  generation/
    html-generator.ts
    ipc.ts

  runtime/
    control-server.ts
    mcp-server.ts
    mcp-registration.ts

  settings/
    experimental-ipc.ts
```

`src/main/index.ts` should stay as the narrow entrypoint. It should import a
small bootstrap function and avoid owning product behavior directly.

## Domain Boundaries

### `app/`

Electron shell ownership:

- app startup and shutdown orchestration
- `BrowserWindow` creation
- custom protocol registration
- link and popup policy
- main-process logging and fatal error hooks
- app icon and about panel setup

This folder should not know about canvas storage internals or agent sessions
beyond calling domain setup/teardown functions.

### `canvas/`

Workspace canvas ownership:

- workspace list/load/save IPC
- canvas JSON layout data
- v1/v2 storage migration
- per-node files
- canvas update broadcasting
- knowledge node records and tags

IPC for canvas data should live in `canvas/ipc.ts`. Node-specific IPC should
live in `canvas/nodes/ipc.ts`.

### `agent/`

Canvas agent ownership:

- chat/session lifecycle
- engine integration
- prompt profile and model config
- workspace context building
- agent tools
- debug trace support
- sending prompts into agent terminal nodes
- workspace documentation generation

The current `agent/` folder owns this domain. `tools.ts` is intentionally still
unsplit after the move; split it once the remaining canvas path churn is
complete.

### `artifacts/`

Generated and pinned artifact ownership:

- artifact metadata and versions
- artifact create/update/delete IPC
- pinning artifacts to canvas nodes

The artifact domain may depend on canvas storage APIs, but canvas should not
depend on artifact internals.

### `webview/`

Embedded page ownership:

- webview registration
- CDP session helpers
- DOM, accessibility tree, and screenshot reads

This domain is intentionally separate from agent tools. The agent can consume
webview capabilities, but webview code should not know about agent sessions.

### `terminal/`

PTY ownership:

- node-pty process lifecycle
- terminal session read/write/kill APIs
- terminal IPC handlers

Agent terminal nodes can use this module through exported session helpers.

### `files/`

Local file helper ownership:

- open/save dialogs
- file read/write helpers exposed to renderer
- file watching
- skill installation file operations

These are file-oriented product capabilities rather than generic utilities.

### `generation/`

Standalone generation ownership:

- HTML generation
- HTML streaming IPC

This module can share model resolution with `agent/model`.

### `runtime/`

Local runtime integration ownership:

- runtime control HTTP server
- local MCP server
- MCP registration

This keeps optional local service endpoints out of the Electron app shell.

### `settings/`

Settings and feature-flag ownership:

- experimental flag overrides
- future settings IPC that does not clearly belong to a product domain

If a setting becomes domain-specific, it should move into that domain.

## File Mapping

```text
src/main/index.ts                         -> src/main/index.ts + src/main/app/*

src/main/canvas-store.ts                  -> src/main/canvas/store.ts + src/main/canvas/ipc.ts
src/main/canvas-storage.ts                -> src/main/canvas/storage/index.ts, then split internally
src/main/canvas-broadcast.ts              -> src/main/canvas/broadcast.ts
src/main/workspace-node-store.ts          -> src/main/canvas/nodes/store.ts
src/main/workspace-node-ipc.ts            -> src/main/canvas/nodes/ipc.ts
src/main/tag-store.ts                     -> src/main/canvas/nodes/tags.ts

src/main/canvas-agent-ipc.ts              -> src/main/agent/ipc.ts
src/main/canvas-model-ipc.ts              -> src/main/agent/model/ipc.ts
src/main/canvas-prompt-ipc.ts             -> src/main/agent/prompt-profile-ipc.ts
src/main/agent-session-send.ts            -> src/main/agent/session-send.ts
src/main/canvas-agent/*                   -> src/main/agent/*

src/main/artifact-store.ts                -> src/main/artifacts/store.ts
src/main/artifact-ipc.ts                  -> src/main/artifacts/ipc.ts

src/main/webview-registry.ts              -> src/main/webview/registry.ts
src/main/webpage-reader-ipc.ts            -> src/main/webview/reader.ts
src/main/cdp-session.ts                   -> src/main/webview/cdp-session.ts

src/main/pty-manager.ts                   -> src/main/terminal/pty-manager.ts

src/main/file-manager.ts                  -> src/main/files/manager.ts
src/main/file-watcher.ts                  -> src/main/files/watcher.ts
src/main/skill-installer.ts               -> src/main/files/skill-installer.ts

src/main/html-generator.ts                -> src/main/generation/html-generator.ts
src/main/html-generator-ipc.ts            -> src/main/generation/ipc.ts

src/main/runtime-control-server.ts        -> src/main/runtime/control-server.ts
src/main/mcp-server.ts                    -> src/main/runtime/mcp-server.ts
src/main/mcp-registration.ts              -> src/main/runtime/mcp-registration.ts

src/main/experimental-ipc.ts              -> src/main/settings/experimental-ipc.ts
src/main/shell-ipc.ts                     -> src/main/app/shell-ipc.ts
```

Completed so far:

- `src/main/index.ts` is now a thin entrypoint that calls `app/bootstrap.ts`.
- `src/main/app/*` owns Electron bootstrap, logging, protocol, window, link
  policy, and shell IPC.
- `src/main/terminal/pty-manager.ts` owns PTY sessions.
- `src/main/files/*` owns file manager, file watcher, and skill installation.
- `src/main/generation/*` owns HTML generation and its IPC.
- `src/main/runtime/*` owns runtime control and MCP helpers.
- `src/main/webview/*` owns webview registry, page reader, and CDP sessions.
- `src/main/artifacts/*` owns artifact storage and artifact IPC.
- `src/main/settings/*` owns experimental feature flag IPC.
- `src/main/agent/*` owns Canvas Agent service, IPC, sessions, model config,
  prompt profile, tools, and workspace documentation generation.
- `src/main/canvas/*` owns canvas store IPC, storage migration, node records,
  tags, and canvas update broadcast helpers.

## Migration Plan

### Phase 1: entrypoint and pure moves

Status: complete.

- Done: extract `app/logging.ts`, `app/protocol.ts`, `app/window.ts`,
  `app/link-policy.ts`, and `app/shell-ipc.ts`.
- Done: keep `src/main/index.ts` as a thin import of `bootstrap()`.
- Done: move `terminal/`, `files/`, `generation/`, and `runtime/`.
- Done: move `settings/`, `webview/`, and `artifacts/`.
- Done: move `agent/`.
- Done: move `canvas/` root files.

Verification:

```bash
pnpm --filter canvas-workspace typecheck:main
pnpm --filter canvas-workspace test -- --runInBand
```

If the test runner does not support `--runInBand`, run:

```bash
pnpm --filter canvas-workspace test
```

### Phase 2: canvas storage split

Split `canvas/storage.ts` by responsibility after the path move is stable:

- `paths.ts`: workspace, canvas, node, backup, and sentinel paths
- `json.ts`: atomic write and read-with-recovery helpers
- `schema.ts`: schema version detection and shared types
- `migration.ts`: v1 to v2 migration, sentinel, and recovery logic
- `node-files.ts`: per-node file read/write/delete/list helpers
- `index.ts`: public exports used by other domains

Verification should include existing canvas storage and graph tests.

### Phase 3: canvas store split

Split `canvas/store.ts` into:

- IPC registration
- in-memory workspace state
- watcher lifecycle
- migration progress broadcasting
- startup pollution audit

Keep the public setup/teardown names stable during the split.

### Phase 4: agent tools split

Split `agent/tools.ts` after imports are stable. Suggested shape:

```text
agent/tools/
  index.ts
  canvas-tools.ts
  file-tools.ts
  terminal-tools.ts
  artifact-tools.ts
  webview-tools.ts
  graph-tools.ts
  image-tools.ts
  schemas.ts
  types.ts
```

This phase carries the highest behavioral risk because tool schemas and names
are part of the agent contract.

## Import Rules

- Domains may depend on lower-level capability modules through public exports.
- `app/` may call `setup*` and `teardown*` functions but should not import
  domain internals.
- `agent/` may read canvas, artifact, webview, and terminal capabilities.
- `canvas/` should not import `agent/`.
- `webview/` should not import `agent/`.
- `artifacts/` may import canvas storage APIs to pin artifacts, but canvas
  should not import artifact internals.
- Prefer `index.ts` barrel files only where they hide internal substructure and
  do not create circular dependencies.

## Compatibility Rules

The following must not change during the structural migration:

- Electron preload API exposed through `window.canvasWorkspace`
- IPC channel names
- on-disk canvas data paths and JSON shapes
- model configuration path and format
- workspace session paths
- runtime control file path and local HTTP API
- plugin registration behavior and canvas-agent tool names

Behavioral changes should be separate follow-up commits after the domain move
has passed typecheck and tests.
