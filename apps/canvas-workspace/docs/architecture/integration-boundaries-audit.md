# Integration Boundaries Audit: Preload, Plugins, Shared

Status: audit only. No runtime code changes are required by this document.

This audit covers the cross-layer boundary around:

- `src/preload/**`
- `src/plugins/main/**`
- `src/plugins/renderer/**`
- `src/plugins/types.ts`
- `src/shared/**`

The goal is to make the Electron process boundary, plugin boundary, and shared
type ownership explicit before more integrations are added.

## Current Boundary Map

```text
src/main/**                    Electron main process, Node/Electron capability owner
  -> src/plugins/main          activates built-in main plugins and reads plugin tool factories
  -> src/shared                shared constants / pure helpers

src/preload/**                 isolated Electron preload bridge
  -> electron ipcRenderer
  -> src/renderer/src/types    current API type source (boundary risk)
  -> src/plugins/types         PluginBridge type

src/renderer/src/**            browser/React application
  -> window.canvasWorkspace    only runtime access to main/preload capabilities
  -> src/plugins/renderer      renderer plugin registry and built-in renderer plugins
  -> src/shared                shared feature flags

src/plugins/main/**            main-side plugin halves
  -> src/plugins/types         plugin contract
  -> Node/Electron APIs        allowed for main-side plugins
  -> selected src/main/**      current host-internal imports (boundary risk)

src/plugins/renderer/**        renderer-side plugin halves
  -> src/plugins/types         plugin contract
  -> React/renderer runtime    allowed for UI plugins
  -> selected src/renderer/**  current host-internal imports (boundary risk)

src/shared/**                  pure cross-process data/constants
```

## Preload Bridge / API Exposure Boundary

`src/preload/index.ts` exposes exactly one renderer global:

```ts
contextBridge.exposeInMainWorld("canvasWorkspace", canvasWorkspace);
```

The main `BrowserWindow` sets `contextIsolation: true` in
`src/main/app/window.ts` and does not explicitly enable renderer Node
integration. The renderer therefore reaches privileged capabilities through
`window.canvasWorkspace`, not through raw `ipcRenderer`, `fs`, `shell`,
`node-pty`, or Electron internals.

The exposed API is domain-shaped:

| API group | Backing bridge | Main capability |
| --- | --- | --- |
| `appInfo` | `bridge/app-info.ts` | app metadata and update check |
| `store` | `bridge/store.ts` | workspace load/save/list/import/export/watch |
| `workspaceNodes` | `bridge/workspace-nodes.ts` | knowledge node metadata and tags |
| `file` / `dialog` | `bridge/file.ts`, `bridge/settings.ts` | file read/write/list, image save/export, dialogs |
| `pty` | `bridge/pty.ts` | terminal spawn/write/resize/kill/status |
| `agent` / `codexSessions` | `bridge/agent.ts`, `bridge/codex-sessions.ts` | chat sessions, streaming events, Codex session lookup |
| `agentTeams` | `bridge/agent-teams.ts` | team lifecycle, dispatch, gates, direct input |
| `artifacts` | `bridge/artifacts.ts` | artifact CRUD, pinning, change events |
| `iframe` / `web` / `llm` | `bridge/webview.ts` | webview registration, web read, HTML generation |
| `shell` / `link` | `bridge/webview.ts` | external link opening and intercepted link events |
| `skills` / `canvasSkills` / `canvasMcp` | `bridge/settings.ts` | local tooling, skill, and MCP config |
| `experimental` / `pluginFlags` | `bridge/settings.ts`, `bridge/flags.ts` | feature flag reads/toggles and preload snapshot |
| `channelConfig` / `builtInTools` | `bridge/settings.ts` | remote channel and built-in tool credentials/config |
| `promptProfile` / `model` | `bridge/settings.ts` | prompt profile and model provider config |
| `plugin` | `bridge/plugin.ts` | generic plugin renderer-to-main IPC bridge |

Healthy aspects:

- Renderer code receives functions, not `ipcRenderer`.
- Event subscriptions use small unsubscribe wrappers in `bridge/ipc.ts`.
- Host IPC channel names stay domain-prefixed (`canvas:*`, `file:*`,
  `agent-teams:*`, `artifact:*`, `plugin:<id>:*`, etc.).
- `shell:openExternal` validates protocols in main before calling
  `shell.openExternal`.
- Experimental flags are snapshotted at preload startup, avoiding repeated
  renderer-to-main flag probes during plugin activation.

Boundary risks:

- Preload imports API types from `src/renderer/src/types.ts` in nearly every
  bridge. That makes the renderer layer the owner of cross-process contracts
  and lets preload depend upward on a browser/React source tree.
- `src/renderer/src/types.ts` contains both renderer-local view types and
  cross-process API/data contracts (`CanvasWorkspaceApi`, `CanvasNode`,
  `AgentTeamsApi`, `Artifact`, `WebReadInput`, etc.). This makes it easy for
  future preload/main code to accidentally inherit renderer-only concerns.
- Some exposed capabilities are intentionally broad and need main-side
  validation discipline:
  - `file.read`, `file.write`, and `file.listDir` accept paths from renderer.
  - `pty.spawn`, `pty.write`, and `pty.kill` give renderer terminal control.
  - `iframe.registerWebview` trusts a renderer-supplied `webContentsId`.
  - `plugin.invoke(pluginId, channel, ...args)` is generic by design; the
    registry namespaces channels but the preload bridge itself does not
    validate plugin IDs or channel names.
- `experimental:read-sync` is a synchronous IPC exception. It is acceptable as
  a preload bootstrap path only; it should not become a pattern for product
  reads.

Rule: preload is a capability adapter, not a policy owner. It should expose
explicit domain methods and subscription helpers, but all authorization,
path validation, payload schema checks, and side-effect policy must live in
main-domain handlers.

## Plugin Main / Renderer Capability Boundary

Plugin contracts live in `src/plugins/types.ts`. The contract intentionally
separates main and renderer halves:

- `MainCanvasPlugin.activate(ctx)` receives `MainCtx`.
- `RendererCanvasPlugin.activate(ctx)` receives `RendererCtx`.
- `PluginBridge` connects renderer plugin halves to their own main half via
  `window.canvasWorkspace.plugin.invoke(pluginId, channel, ...args)`.

### Main-Side Plugins

`src/plugins/main/registry.ts` grants main plugins these capabilities:

- `ctx.store`: namespaced JSON storage under Electron `userData/plugins/<id>`.
- `ctx.handle(channel, handler)`: plugin-owned IPC, auto-prefixed as
  `plugin:<pluginId>:<channel>`.
- `ctx.onAgent(event, handler)`: subscribe to canvas-agent lifecycle events.
- `ctx.getAgentService()`: narrow structural view of the Canvas Agent service.
- `ctx.registerCanvasTool(factory)`: contribute workspace-scoped canvas-agent
  tools.

Built-in main plugins currently use these capabilities as follows:

- `devtools`: listens to `turnEnd`, persists traces in plugin storage, exposes
  `list-runs` and `get-run` plugin IPC.
- `dynamic-app`: registers agent tools, owns a local HTTP runner/reconciler,
  persists dynamic app specs beside workspace data, and exposes inspector IPC.
- `webview-page-control`: registers agent tools that operate live iframe
  webviews through policy checks and CDP helpers.
- `channel`: starts external chat channels, drives the agent service, and can
  activate a workspace window for remote turns.

Healthy aspects:

- Main plugins cannot register arbitrary host IPC names through `MainCtx`;
  `ctx.handle` prefixes every channel with `plugin:<id>:`.
- Agent access is structural through `CanvasAgentServiceRef` instead of a
  direct `CanvasAgentService` import.
- Canvas-agent tool registration is centralized and read by
  `src/main/agent/tools/index.ts`.

Boundary risks:

- Several main plugins import host internals directly:
  - `dynamic-app` imports `main/canvas/storage` and `main/canvas/broadcast`.
  - `webview-page-control` imports `main/webview/registry`,
    `main/webview/ensure-operable`, `main/webview/cdp-session`,
    `main/app/window-manager`, and `main/agent/tools` types.
  - `channel` imports `main/app/window-manager`.
  - `devtools` imports `main/agent/types`.
- Direct host imports make plugin behavior sensitive to main-domain refactors
  and weaken the "plugin as extension" model. They are acceptable as current
  built-in-plugin shortcuts, but should not become the default for new plugin
  capabilities.
- `src/main/app/bootstrap.ts` imports channel config IPC/config directly from
  `src/plugins/main/channel/*`. That makes app bootstrap aware of a specific
  plugin implementation outside the generic plugin registry.
- Plugin-contributed canvas tools are merged with "last writer wins" semantics.
  This is useful for deliberate shadowing, but any future third-party plugin
  path should require collision warnings or an allowlist.

Recommended shape: when a plugin needs host state, add a narrow capability to
`MainCtx` or a stable host adapter instead of importing an internal module. For
example, prefer `ctx.canvas.readFull(workspaceId)` or
`ctx.webviews.getForNode(workspaceId, nodeId)` over direct imports from
`src/main/canvas/storage` or `src/main/webview/registry`.

### Renderer-Side Plugins

`src/plugins/renderer/registry.ts` grants renderer plugins these capabilities:

- `ctx.registerRoute(path, Component)`.
- `ctx.registerChatCard(spec)`.
- `ctx.registerNavItem(item)`.
- `ctx.invoke(channel, ...args)`, scoped to the same plugin ID through
  `PluginBridge`.

The host renderer consumes registered output in:

- `src/renderer/src/main.tsx`: activates built-in renderer plugins before the
  first React render.
- `src/renderer/src/App.tsx`: reads registered routes and nav items.
- `src/renderer/src/components/chat/ChatMessage.tsx`: renders matching plugin
  chat cards.

Healthy aspects:

- Renderer plugins do not receive raw `window.canvasWorkspace` as their formal
  context; plugin main communication goes through `ctx.invoke`.
- Routes/nav/cards are registration APIs rather than direct mutation of host
  app state.

Boundary risks:

- `src/plugins/renderer/devtools` imports host renderer internals:
  `src/renderer/src/types` and `src/renderer/src/components/icons`.
- `src/plugins/types.ts` imports React `ComponentType` as a type. This is
  acceptable for the renderer contract today, but it means the shared plugin
  type file is not framework-agnostic.
- Registered route paths and nav item IDs are checked for duplicates, but
  there is no higher-level namespace convention beyond plugin discipline.

Recommended shape: renderer plugins may render React components and call their
own main half, but reusable data contracts should come from `src/shared/**` or
`src/plugins/types.ts`, not from `src/renderer/src/types.ts`; reusable UI
building blocks should be promoted to a small public renderer/plugin UI surface
before plugins import them.

## Shared Type Ownership

`src/shared/experimental-features.ts` is currently a good shared module:

- It is pure TypeScript.
- It imports no Electron, Node, React runtime, main, preload, renderer, or
  plugin implementation modules.
- It exports stable constants, a small data type, and a pure resolver.
- It is consumed by main settings, main agent debug, plugin main flag gates,
  and renderer feature-gated routes/settings UI.

The broader type ownership is less clean:

- Cross-process API/data contracts mostly live in `src/renderer/src/types.ts`.
- Preload imports those renderer-owned contracts.
- Plugin renderer devtools imports renderer-owned trace types.
- `ExperimentalFeatureDef` is duplicated in both `src/shared/experimental-features.ts`
  and `src/renderer/src/types.ts`.

Recommended ownership:

- `src/shared/**` should own JSON-safe, cross-process data contracts and pure
  helpers used by more than one layer.
- Renderer-only component props, hook state, DOM/UI helper types, and visual
  state should remain under `src/renderer/src/**`.
- Main-only service interfaces and persistence internals should remain under
  `src/main/**`.
- Plugin host contracts should remain under `src/plugins/types.ts`, but
  plugin contracts that are main-only and renderer-only can be split later if
  React typing starts leaking into main builds.

Good candidates to move out of `src/renderer/src/types.ts` over time:

- `CanvasWorkspaceApi` and API group interfaces.
- Canvas persistence data (`CanvasNode`, `CanvasEdge`, `CanvasSaveData`).
- Agent/team/artifact/web-read DTOs that are returned through IPC.
- Feature flag DTOs currently duplicated from `src/shared`.

## Reverse Dependency And Broad Dependency Risks

### Reverse Dependencies

These are the notable reverse or upward imports:

- `src/preload/** -> src/renderer/src/types.ts`.
- `src/plugins/renderer/devtools/** -> src/renderer/src/**`.
- `src/plugins/main/** -> src/main/**`.
- `src/main/app/bootstrap.ts -> src/plugins/main/channel/*` for channel config.
- `src/renderer/src/types.ts -> src/plugins/types.ts` for `PluginBridge`.

Not all are wrong in the current built-in-plugin model, but each should be
treated as an explicit exception rather than a precedent.

### Broad Dependencies

Broad capability surfaces that deserve extra care:

- File API: arbitrary renderer-supplied paths can read/write/list local files.
- PTY API: renderer can spawn and control shell sessions.
- Agent/team APIs: renderer can start long-running model/tool workflows and
  send input to managed terminals.
- Webview APIs: renderer registers live webContents IDs; plugin tools can
  operate embedded pages when experimental flags are enabled.
- Plugin bridge: generic `plugin:<id>:<channel>` invocation is flexible but
  depends on each plugin's main half validating arguments.
- Dynamic-app plugin: runs local HTTP servers and LLM-authored sandboxed code;
  it also writes workspace-local dynamic app state directly.
- Channel plugin: external chat input can drive the Canvas Agent once the
  feature flag and credentials are configured.

These capabilities are product requirements, not automatic bugs. The boundary
requirement is that every broad surface has a narrow exposed method name,
domain-owned validation, logging/audit where useful, and no raw privileged
object crossing into renderer or plugin renderer code.

## Recommended Dependency Rules

Allowed import direction:

```text
src/shared        -> no app-layer imports
src/plugins/types -> shared/types only; no main/preload/renderer implementations

src/main          -> src/shared, src/plugins/main public entrypoints
src/preload       -> electron, src/shared, src/plugins/types
src/renderer      -> src/shared, src/plugins/renderer public entrypoints

src/plugins/main     -> src/plugins/types, src/shared, Node/Electron
src/plugins/renderer -> src/plugins/types, src/shared, React/renderer runtime
```

Rules:

1. Preload must not import from `src/renderer/**` or `src/main/**`. Move
   cross-process API contracts to `src/shared/**` first, then point preload
   and renderer at the same shared contract.
2. Renderer must not import from `src/main/**`, `src/preload/**`, or Electron.
   Runtime capability access stays behind `window.canvasWorkspace`.
3. Main must not import from `src/renderer/**` or `src/preload/**`. Main may
   import `src/plugins/main` public registry entrypoints, but direct imports
   into individual plugin implementation folders should be avoided.
4. `src/shared/**` must stay pure: no Electron, Node filesystem/process APIs,
   React runtime, DOM globals, side effects, persistence, or IPC.
5. `src/plugins/types.ts` should stay a contract file. It may contain
   structural service views and type-only UI types, but must not import host
   implementation modules.
6. Main plugins should use `MainCtx` capabilities for host integration. Direct
   imports from `src/main/**` are allowed only for documented built-in-plugin
   exceptions or stable public adapters.
7. Renderer plugins should use `RendererCtx` and their own `ctx.invoke`.
   Imports from `src/renderer/src/**` should be limited to stable public UI or
   shared DTO surfaces; promote those surfaces before adding more plugin usage.
8. New IPC must be added as a named domain method on `CanvasWorkspaceApi`, not
   as a raw `invoke(channel, payload)` escape hatch, except for the existing
   namespaced plugin bridge.
9. Every main IPC handler that accepts filesystem paths, process control,
   webContents IDs, external URLs, credentials, or remote messages must validate
   payload shape in main and return structured `{ ok, error }` results.
10. New shared DTOs should be JSON-safe unless they are explicitly type-only.
    Do not put React components, class instances, Electron objects, functions,
    or Node handles in shared data contracts.

## Suggested Follow-Up Work

1. Create a shared API contract module, for example
   `src/shared/canvas-workspace-api.ts`, and move `CanvasWorkspaceApi` plus API
   group interfaces there.
2. Move canvas persistence DTOs (`CanvasNode`, `CanvasEdge`, `CanvasSaveData`)
   into `src/shared/canvas-types.ts`.
3. Move agent/team/artifact/web-read IPC DTOs into domain-named shared files.
4. Replace preload imports from `src/renderer/src/types.ts` with shared imports.
5. Add a lightweight import-boundary check for the rules above. Even a small
   script that fails on `preload -> renderer`, `renderer -> main`, or
   `shared -> app layer` imports would catch the highest-risk regressions.
6. For built-in main plugins, introduce stable host capability adapters before
   further direct imports from `src/main/**` spread.
