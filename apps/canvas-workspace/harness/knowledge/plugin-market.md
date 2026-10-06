# Agent Plugins Market

This file records the implemented Pulse Canvas Agent Plugins market. Product intent and acceptance live in `../../../../docs/plugin-system/agent-plugins-market-goal.md`; ecosystem research lives in `../../../../docs/plugin-system/community-agent-plugins-ecosystem-2026-08-12.md`.

## Runtime flow

```text
/plugins renderer
  -> typed preload PluginMarketApi
  -> plugin-market:* IPC
  -> PluginMarketService
      -> curated catalog / local directory / HTTPS Git snapshot
      -> package reader (v1 first, legacy only when v1 is absent)
      -> canvas-plugins.json registration
      -> plugin-market.json install + native trust state
      -> skills scan + generated MCP adapter
      -> reload external main plugins and Canvas Agent MCP
      -> reconcile renderer federation registrations in the current window
```

The market is a Canvas application feature, not the engine's `EnginePlugin` or `UserConfigPlugin` system.

## Module map

| Responsibility | Owner |
|---|---|
| Cross-process package, listing, source, diagnostics and API contracts | `src/shared/plugin-market.ts` |
| v1/legacy package precedence and normalized package result | `src/main/plugin-market/package-reader.ts` |
| Path containment and filesystem helpers | `src/main/plugin-market/package-reader-support.ts` |
| Strict immediate-child Agent Skills discovery | `src/main/plugin-market/package-reader-skills.ts`, `skill-scan.ts` |
| Agent Plugins v1 MCP validation | `src/main/plugin-market/package-reader-mcp.ts` |
| `extensions["com.pulsecanvas"]` normalization | `src/main/plugin-market/package-reader-pulse.ts` |
| Legacy `manifest.json` fallback | `src/main/plugin-market/package-reader-legacy.ts` |
| Curated public discovery entries and installability flags | `src/main/plugin-market/catalog.ts` |
| Install, link, uninstall, trust mutation and runtime reload orchestration | `src/main/plugin-market/service.ts` |
| Install/trust state and managed storage paths | `src/main/plugin-market/store.ts` |
| Standard v1 MCP to Pulse MCP config conversion | `src/main/plugin-market/mcp-adapter.ts` |
| Normalized package to legacy Canvas registries/config adapter | `src/main/plugin-market/canvas-package-adapter.ts` |
| Canvas plugin directory/config SSOT and skill sources | `src/main/plugin-market/config.ts` |
| IPC registration and preload bridge | `src/main/plugin-market/ipc.ts`, `src/preload/bridge/plugin-market.ts`, `src/preload/index.ts` |
| Route, state, filters, rows and dialogs | `src/renderer/src/modules/plugin-market/`, wired by `src/renderer/src/app/App/index.tsx` |
| Installed-plugin `@` mentions and request-context collection | `src/renderer/src/modules/chat/mentions/pluginMentionItems.ts`, `modules/chat/components/ChatComposer/useChatComposerInput.ts` |
| Turn-level plugin routing guidance | `src/main/agent/plugin-selection-context.ts` |
| Canvas Agent skills/MCP composition | `src/main/agent/engine-plugins.ts` |

## Package selection contract

`readPluginPackage(packageDir)` returns one normalized package plus structured diagnostics.

1. If root `plugin.json` exists, it is authoritative. It must declare the v1 schema and valid v1 name. Skills come only from direct `skills/<name>/SKILL.md` children; optional MCP comes only from root `mcp.json`; Pulse data comes only from `extensions["com.pulsecanvas"]` (and an optional package-contained directory with that name).
2. A present but invalid `plugin.json` is rejected. The reader never merges fields from, or falls back to, `manifest.json`.
3. Only when `plugin.json` is absent may `manifest.json` be read as `legacy-canvas`. Legacy metadata remains authoritative and its declared skill paths are normalized with the same containment checks.

`canvasEntryFromPackage()` bridges the normalized result to existing Canvas main/renderer/node/config registries. Skills remain available independently of Pulse native-extension trust.

## IPC and renderer contract

`window.canvasWorkspace.pluginMarket` exposes eight request/response methods:

| IPC channel | API method | Meaning |
|---|---|---|
| `plugin-market:list` | `list()` | Build the current local/catalog snapshot. |
| `plugin-market:refresh` | `refresh()` | Rebuild the same snapshot; this is not a remote registry sync. |
| `plugin-market:install` | `install(listingId)` | Install an `available` curated entry. |
| `plugin-market:uninstall` | `uninstall(listingId)` | Unregister and conditionally remove a managed snapshot. |
| `plugin-market:connect-mcp` | `connectMcp(listingId)` | Retry remote MCP connections and start OAuth only after a 401 challenge. |
| `plugin-market:set-native-enabled` | `setNativeEnabled(listingId, enabled)` | Change the separate Pulse native-extension trust bit. |
| `plugin-market:choose-directory` | `chooseDirectory()` | Link a user-selected local package. |
| `plugin-market:add-git` | `addGit(source)` | Clone and install a validated HTTPS Git source. |

Every operation returns JSON-safe data from `src/shared/plugin-market.ts`. Renderer code has no Electron/Node access; browsing a source uses the existing typed shell preload API.

The Plugins and Skills library routes reserve the expanded RightDock width instead of letting it overlay page content. Plugin rows use a container query against the remaining page width, so the catalog is two columns when space permits and one column beside a wide dock. Plugin details use a route-scoped dialog: its backdrop and card stay inside the Plugins surface, omit global `aria-modal` semantics, and do not trap keyboard focus away from the persistent RightDock. `Connect` keeps the details visible for connection status while the OAuth link tab opens alongside it in the dock.

## Chat mention semantics

The chat `@` picker offers healthy installed market listings in a dedicated Plugins group. Selecting one serializes a stable `@[plugin:<encoded-listing-id>|<encoded-name>|<optional-icon-key>]` marker and adds `{ id, name }` to `AgentRequestContext.plugins`; turn snapshots preserve the same refs for regenerate/replay. The marker renders as a plugin chip in both the composer and transcript. Mention rows and chips reuse the market's client-owned brand images; well-known personal packages such as Notion may be recognized by name, while unknown packages use the generic plugin glyph. Agent Plugins v1 itself does not define a portable icon field.

An `@Plugin` is an explicit turn-level routing preference and scope hint. It does not force a tool call, connect a plugin, disable unrelated tools, or replace the agent's default ability to choose plugins automatically. When the request benefits from the selected package, the system prompt tells the agent to prefer that package's already-loaded skills or MCP tools; unavailable or disconnected capabilities must degrade honestly. Only installed listings without package-read errors are mentionable. Renderer discovery uses the existing `pluginMarket.list()` API and a short cache, so typing in the composer does not introduce a second plugin registry.

## Catalog semantics

`PluginMarketListing.installState` is authoritative for the UI:

- `available`: Pulse has an install adapter and may offer `Install`;
- `installed`: the package is registered in `canvas-plugins.json` and represented in the market snapshot;
- `unsupported`: discovery only; the UI offers `Explore` and opens the Git source.

The launch catalog contains six reviewed, installable Agent Plugins v1 packages: Exa, TranscriptAPI, Arcade, Resend, OpnForm, and Mobbin. Each entry points at a concrete package root that passes the strict reader; OpnForm uses a repository subdirectory. The catalog is intentionally small and compiled into the app because Agent Plugins defines package structure, not discovery or marketplace governance. Do not mark a repository installable merely because it contains reusable skills or a file named `plugin.json`.

## State and disk layout

All paths are under Electron `app.getPath('userData')`:

```text
canvas-plugins.json
plugin-market/
  plugin-market.json
  packages/<safe-listing-id>/<commit-sha>/...
  runtime/<safe-listing-id>/mcp.json
  data/<safe-listing-id>/...
```

- `canvas-plugins.json` remains the registration/config SSOT (`pluginDirs`, existing `pluginConfig`).
- `plugin-market/plugin-market.json` stores versioned records: listing/package identity, normalized root, source, format, managed flag, native trust, install time and optional generated MCP config path. Writes use a temporary file followed by rename.
- A local directory record has `managed: false`; uninstall removes registration/state but never deletes the source directory.
- A Git install is copied to a commit-SHA path with `managed: true`; uninstall deletes it only after confirming the target is a child of the managed packages root.
- Generated runtime/data directories are not currently garbage-collected on uninstall. Their paths leave active configuration when the state record is removed, but the files may remain on disk.

## Trust behavior

Installation and Pulse-native enablement are separate decisions:

| Capability | After install | Additional trust |
|---|---|---|
| Agent Skills | active through plugin skill scan paths | none beyond install |
| Standard MCP | generated into Pulse runtime config and reloaded | remote OAuth is a separate `Connect` action; stdio may execute a process at install time |
| `com.pulsecanvas` main/renderer/nodes/config | hidden for market-managed packages | explicit `nativeEnabled: true` |

New market records always start with `nativeEnabled: false`. Strict v1 packages without a market record also default to native-disabled. Untracked legacy Canvas plugin directories retain the old default-enabled native behavior for compatibility; market-managed legacy packages obey the explicit trust bit.

Changing installation or native trust calls both `reloadConfiguredExternalMainPlugins()` and `CanvasAgentService.reloadMcp()` so the effective runtime follows persisted state.

MCP reload must activate the target scope before rebuilding the engine and then obtain a fresh status probe. Previously a reload against an inactive scope returned stale or empty state. `src/main/agent/service.ts` implements `activateScope(targetScope)` before `reloadEngine()`; preserve that order for explicit connect/load actions.
The market renderer then reads the execution-authoritative Canvas plugin status, dispatches the shared plugins-changed event, and reconciles renderer federation registrations so disabling or uninstalling a native extension removes its routes, navigation items, chat cards, and node views from the live window.

## MCP adapter

The v1 reader accepts stdio, streamable HTTP and SSE servers after validating the closed MCP schema.

- `./` stdio commands and cwd paths are resolved to canonical package-contained paths; bare executable names are allowed for PATH lookup.
- `${PLUGIN_ROOT}` and `${PLUGIN_DATA}` are the only plugin runtime placeholders. The adapter expands them in args/env/cwd and injects both environment variables; plugin env cannot override them.
- Server config keys become `<safe-plugin-name>.<server-name>` to reduce collisions. The engine preserves that key for status and OAuth lookup, but normalizes punctuation in the model-visible tool name (for example `mcp_exa.exa_search` becomes `mcp_exa_exa_search`).
- `streamable-http` maps to Pulse `http`; `sse` remains `sse`.
- Remote URLs must be HTTP(S), with plain HTTP limited to loopback. User information and fragments are rejected.
- Public literal headers are preserved, but credential-bearing names such as `Authorization`, `Cookie`, `Proxy-Authorization`, `X-API-Key` and `API-Key` are rejected. Cross-origin redirect header stripping remains the transport layer's responsibility.
- Remote connection state comes from the active engine MCP status, not the OAuth token store. Anonymous servers report `connected` after successful initialization and tool discovery. `Connect` reloads the global scope first and starts OAuth only for an HTTP/SSE transport 401 challenge or the Canvas provider's explicit interactive-authorization request after stored credentials fail. Other failures retain their connection error. The engine injects the OAuth provider only when stored credentials exist, avoiding dynamic registration during ordinary discovery. The market matches the AI SDK transport status field in the retained error message; response-body text is not an authorization signal. Regression cases live in `src/main/plugin-market/service.test.ts`.
- Market MCP config paths are loaded before global/workspace MCP configs, so later user-owned global/workspace definitions retain override precedence on duplicate names.

## Security invariants

- Resolve package roots and referenced files with realpaths; every manifest, skill, executable, renderer asset, icon, extension directory and Git subdir must remain inside its owning root. Treat symlinks as paths to validate, not trusted shortcuts.
- Accept Git sources only as credential-free HTTPS URLs. Reject option-like refs and absolute/traversing subdirectories. Execute Git with `execFile` argument arrays and bounded time/output.
- Clone Git with LFS smudging disabled, ignore repository metadata, and reject symlinks or special entries. Bound managed snapshots to 2,048 entries, 1,024 files, 16 MiB per file, 64 MiB total and 512 UTF-8 bytes per relative path.
- Validate a Git package before copying it, then validate the copied snapshot again. Managed destination paths include the resolved commit SHA.
- Never use legacy fallback to rescue a present invalid v1 manifest.
- Installation authorizes skills and MCP, including possible stdio process execution. Do not describe install as data-only.
- Never expose Pulse native main/renderer capabilities for a market-managed package unless its persisted trust bit is true.
- Never recursively delete a linked directory or a path that is not contained by the market-managed packages root.

## MCP Apps host

Agent Plugins packaging remains unchanged: optional UI is discovered from MCP Tool metadata, not from `plugin.json` or `mcp.json`. The engine MCP manager recognizes `_meta.ui.resourceUri`, the deprecated `ui/resourceUri`, and the OpenAI compatibility alias `openai/outputTemplate`; it retains the owning server/tool mapping and exposes JSON-serializable UI resources plus bounded resource-list and enabled-tool calls to Canvas. UI Resource bodies are intentionally not size-limited so self-contained MCP Apps can bundle large frameworks; tool-result capture remains capped at 2 MiB.

Canvas tool-result events preserve a bounded, policy-approved pre-offload MCP result envelope for app tools while keeping the legacy model-facing string result for ordinary transcript rendering. The renderer reads the `ui://` resource through typed main/preload IPC and renders it inline using the official MCP Apps `AppBridge` and `PostMessageTransport`. A host-owned `pulse-mcp-app://sandbox` outer frame receives a response-header CSP and relays to an opaque-origin inner app frame; origin checks revoke the bridge immediately if the inner document navigates away. The sandbox keeps `allow-same-origin` disabled, but installs document-lifetime in-memory `localStorage`/`sessionStorage` shims before App code and permits non-network `data:` fetches for compatibility with Cesium-class apps. The host advertises `inline` and `fullscreen`: a fullscreen request opens one deduplicated right-Dock tab for the message-scoped app instance, while closing that tab restores inline mode and keyboard focus. The sandbox relays Escape and activation from the opaque app document to the host so iframe focus does not trap fullscreen or break split-pane focus. The iframe is never reparented because Chromium recreates its browsing context when an iframe changes parents. It lives in one body-level Portal for its entire lifetime; the surface follows either the inline chat anchor or the Dock-registered fullscreen anchor, hides when its target is off-screen/inactive, and updates host-context mode and dimensions. The portal mirrors anchor/ancestor visibility (including retained inactive panes), observes ancestor visibility and size changes, and clips to the intersection of ancestor scrollports and the window without shrinking the iframe viewport. Zero-sized or detached anchors stay hidden and non-interactive. Non-positive/non-finite app size notifications preserve the last usable inline height: SDK max-content measurement can report zero for fixed-position canvas apps. This avoids iframe reload, cross-tab overlays, and painting or intercepting clicks outside the chat scrollport. Regression guards live in `McpAppFrame/__tests__/McpAppFrame.test.tsx` and `useMcpAppSurfacePlacement.test.tsx`. The host also provides a quiet inline expand control. App-initiated tools use the Engine's registered-tool execution path (schema and before/after hooks, without model-visibility filtering). App calls reuse `classifyCanvasToolOperation` with the bare tool name: recognized reads execute without a modal; write/execute/destructive and unknown calls require host confirmation with the complete bounded arguments; the user may remember that MCP server for the current renderer session and agent scope, and the grant is cleared when the renderer exits. Requests retain concurrency and timeout limits. Pending confirmations serialize per renderer instead of rejecting concurrent calls; up to 64 calls can await the current decision. Existing session grants bypass the approval queue; a grant is also rechecked when each waiter resumes. Parameter binding is unchanged. Failed confirmation of a disabled/disconnected tool releases only its exact matching request; mismatched arguments cannot clear another dialog. Renderer destruction releases waiters. Frame error/teardown or unmount cancels visible and late-arriving approvals. Guards: `mcp-app-ipc.test.ts` and `useMcpAppApproval.test.tsx`. App-authored chat messages, PiP, downloads, external links, sampling, camera/microphone, and OpenAI-only `window.openai` extensions are intentionally absent.

### Canvas MCP App nodes

Tools that declare static entrypoints (`_meta["pulse/ui"].entrypoints` with `type: "node"`, or OpenAI's `_meta["openai/ui"]` `global`/`thread`) can be placed on the canvas. The engine parses entrypoints for every loaded MCP App tool (`MCPAppsManager.listToolApps()`), so market packages and user `mcp.json` servers are treated alike, within the active agent scope. `src/main/agent/mcp-app-entrypoints.ts` picks one entrypoint per tool (Pulse `node` over `global` over `thread`) and drops a `thread` entry when the same server already exposes the same UI resource as `global`.

- `canvas-agent:mcp-app-list-entrypoints` feeds the MCP Apps section of the canvas right-click create menu.
- `canvas-agent:mcp-app-open-entrypoint` calls the entrypoint tool with `{}` and no approval prompt: opening is a host UI action. It refuses tools without a supported entrypoint, so it cannot bypass the in-app approval for other tools. Calls the app makes from inside its view keep the approval flow above.
- Nodes use the generic `plugin` shell (`pluginId: "mcp-apps"`, `nodeType: "mcp-app"`); `data.payload` holds only the host-owned binding (`src/shared/mcp-app-node.ts`). Every mount re-opens the entrypoint with `{}`, so restart restores the view without persisting app state.
- The view reuses `McpAppFrame` with `embedded`: the iframe is laid out inside the node (no body portal, no Dock fullscreen, app size requests ignored), so canvas zoom, clipping, and node stacking apply. Host context adds `"pulse/node": { nodeId }`.
- The main-side `read` capability returns the binding, points the Agent at the server's `mcp_<server>_*` tools, and includes bounded live view context when the node is mounted; there is no plugin `write` or action. `mcp-app-node-context.ts` owns volatile snapshots scoped to workspace/node and the exact server/tool/resource binding. Renderer-owned leases reject old-mount and cross-renderer updates and clear on unmount, teardown/error, or renderer destruction. Nothing is persisted into the node payload.
- A freshly created node can mount before the document's debounced save. A `node-not-persisted` registration response makes the frame await the existing workspace persistence writer and retry once; unmount cancels that retry. Other registration failures remain failures. The main-process node/binding validation is unchanged, and no timeout is used to guess when the node has been saved. Guard: `useMcpAppNodeContext.test.tsx`.
- The sandbox HTML, node-context handlers/state, and the App tool-call handler (classification plus approval state/queue) load on first use; its IPC channel still registers synchronously. Shared request bounds and scope resolution stay in `mcp-app-request.ts`. Protocol and IPC registration stay synchronous, so the preload can call them immediately while App-only payload stays out of the main startup entry. Guards: `protocol.test.ts`, context IPC semantic-read tests, and the main-bundle performance gate.
- Node frames seed context from their opening tool result and receive `ui/update-model-context` text/structured updates through `AppBridge`. Opening data is labelled separately from current view state. A host-enabled script inside the existing opaque sandbox also supplies bounded visible text and non-password form values, so library pages that do not publish model context remain readable. Updates are deduplicated and throttled; hidden/offscreen text, script bodies, password/file inputs, and binary images are excluded. Snapshots are untrusted data, never instructions. The existing semantic node read feeds both `canvas_read_node` and selected-node chat context. Regression guards cover bridge publication, library filtering, binding/scope isolation, replacement races, and lifecycle cleanup in the MCP App frame, sandbox view-context, and main context-store/IPC suites.
- Selected and `@`-mentioned nodes are content-first context. Explicit inline node mentions replace ambient canvas selection in both ordinary and queued/steered submissions; without a node mention the current selection remains. `selection-focus-context.ts` tells the Agent to read the exact referenced node, answer summaries/queries from its live view, and supplement only specific missing information. MCP App semantic reads put the view before server-tool fallback guidance and identify the entrypoint as an opening action, so reading an existing node does not imply rendering a duplicate App in chat. An additional plugin mention retains that node-first priority. This is model routing guidance, not a new execution/approval gate; explicitly requested App opening remains available. Guards: `useChatComposerSubmission.node-focus.test.tsx`, `knowledge-selection-prompt.test.ts`, `plugin-selection-context.test.ts`, and the MCP App semantic-read/IPC tests.

### Global MCP Apps (OpenAI sidebar entrypoints)

ChatGPT opens a `global` entrypoint from its sidebar as one permanent, fullscreen app. Pulse maps it to the left Sidebar and the main area.

- The Sidebar Apps section (`app/shell/Sidebar/AppsSection`) lists `global` entrypoints from the global agent scope only. It asks `canvas-agent:mcp-app-list-entrypoints` with `kind: "global"`, which lists every entrypoint of that kind, so a tool that also declares a preferred Pulse `node` still appears; the kind-less call keeps the one-per-tool canvas projection. `thread` and Pulse `node` entrypoints do not appear there. The list scrolls inside a bounded height (expanded and collapsed) so Workspaces and Settings stay reachable. No MCP change event reaches the renderer, so the list is re-read on every view change, which covers returning from Plugins.
- Clicking an app opens `/apps/<server>/<tool>`. `globalMcpAppsStore` keeps one instance per server tool for the renderer lifetime, shared by every workspace. Nothing is persisted: after a restart no app is running, and a route that names an app opens it once its listing is known (once per route key, so closing does not reopen it). While the listing loads the route shows an opening state; a failed listing shows its error with Retry instead of a blank view.
- `GlobalMcpAppsView` mounts one pane per running app and hides the inactive ones with `hidden`. Each pane opens the entrypoint with `{}` through the shared `useMcpAppEntrypoint` (also used by canvas nodes) and hosts an embedded `McpAppFrame` with `embeddedDisplayMode="fullscreen"`. The pane bar reloads (remount, new `{}` call) or closes the instance; closing the shown app returns to the canvas.
- Global frames advertise text/structured `ui/update-model-context` and reuse the sandbox's bounded visible-text observer. `globalMcpAppsStore` keeps separate volatile snapshots per running instance and source. Each publication replaces that source; close, reload, error, teardown, or unmount clears it. Exact running-instance identity rejects old-frame updates after close/reopen or reload. Only the routed active App supplies context; hidden keep-alive panes cannot contribute to a turn.
- Composer submission freezes the active App snapshot into the existing `AgentRequestContext.mcpAppContext` on both ordinary and queued/steered submissions. The conversation runtime persists it on the user message. Edit/regenerate replay that recorded snapshot. Main prompt formatting labels App content as untrusted data, prioritizes model/visible view state over opening data, and preserves explicit node/tab focus. MCP configuration still uses global scope; the request belongs to the submitting conversation. This is bounded text context, not full OpenAI attachment/modelContext notification support. Guards: `globalMcpAppContext.test.ts`, `McpAppFrame.test.tsx`, composer node-focus, conversation-runtime persistence, recovery, and `mcp-app-chat-context.test.ts`.
- The Sidebar marks only the shown app as active; running state has no indicator.
- Icons follow OpenAI's order as far as the engine can see it: the tool's MCP `icons` (server icons are unavailable, see the engine `plugin-system.md`), then a letter tile. `mcp-app-icons.ts` accepts `data:` and `https:` sources, fetches remote ones in the main process through Electron `net` (5 s timeout, 128 KiB cap, `redirect: "error"`, no `localhost` or IP-literal hosts), checks the declared type against the content (SVG, PNG, JPEG, WebP), and sends only base64 data URIs to the renderer. Up to 4 candidates per theme resolve in parallel and the first usable one in declared order wins. A listing waits at most 1.5 s for icons; slower ones finish into the cache for the next listing. Results are cached per `src`; failures retry after 5 minutes. SVG renders as a `currentColor` mask so it follows text and active colors; raster icons render as images. A `theme: "dark"` icon replaces the default under `:root.dark`. Guards: `mcp-app-icons.test.ts`, `AppsSection.test.tsx`.
- Startup bundle: the Sidebar and App shell import only `modules/mcp-apps/global-apps.ts` (store, hook, tile). `GlobalMcpAppsView` loads lazily through the root barrel and mounts only after an app is opened or routed to, and the main process imports `mcp-app-icons.ts` on first listing. Importing the root barrel from the shell measured +35 KB raw in the renderer entry chunk and failed the bundle gate.
- MCP App IPC accepts any server or tool name up to 128 characters without control characters: names are user config keys (spaces and slashes are legal) and every lookup goes through the manager. Guard: `mcp-app-entrypoint-ipc.test.ts`.
- Lifecycle guards: `GlobalMcpApps.test.tsx` (store, keep-alive panes, route open and close), `AppsSection.test.tsx`, and `routeModel.test.ts`.

Chat's `@` menu lists global MCP App entrypoints in an Apps group. Markers
encode server and entrypoint tool identity, so duplicate names do not merge.
Explicit App references take precedence over the ambient active App. Only the
visible App contributes a send-time view snapshot; hidden, closed, reloaded,
or unmounted Apps contribute identity only. Multiple references are deduplicated
by server/tool. The conversation stores `mcpAppMentions` with the user turn;
edit, regenerate, and queued sends keep those captured snapshots. Guards:
`chat/mentions/appMentionItems.test.ts`, composer submission tests,
`mcp-app-chat-context.test.ts`, and conversation runtime/recovery tests.

## Validation entry points

Let the repository runner select the bound Canvas checks for a change:

```bash
node scripts/harness/run-harness-check.mjs --path apps/canvas-workspace/src/main/plugin-market apps/canvas-workspace/src/shared/plugin-market.ts apps/canvas-workspace/src/preload/bridge/plugin-market.ts apps/canvas-workspace/src/renderer/src/modules/plugin-market
```

Focused iteration:

```bash
pnpm --filter canvas-workspace exec vitest run src/main/plugin-market src/renderer/src/modules/plugin-market
pnpm --filter canvas-workspace typecheck
node apps/canvas-workspace/harness/tools/describe-canvas.mjs
```

The focused suites cover package precedence/containment, skill scanning, MCP conversion, Git source validation and size limits, OAuth connection state, Canvas config adaptation and renderer interactions. `describe-canvas.mjs` is required whenever main/preload IPC changes. For visual or interaction changes, drive the real Electron app through `harness/skills/canvas-harness/SKILL.md`; do not treat happy-dom component tests as visual proof.

## Current limits

- The public catalog is compiled into the application; `refresh` does not fetch a registry.
- There is no automatic update, signature/reputation service, dependency resolver, version rollback or marketplace publishing flow.
- Claude/Codex marketplace and arbitrary skill-collection adapters are not implemented.
- Remote MCP OAuth requires an interactive browser handoff. The market reports connection state, but does not manage provider-specific accounts or consent screens.
- Public literal remote headers are supported, but the market does not independently enforce redirect-origin stripping; credential-bearing fixed headers are rejected instead.
- Runtime refresh is not yet coordinated with an already-running chat turn. Installing, uninstalling, or changing native trust while an MCP tool call is in flight can interrupt that call; the persisted change remains authoritative and is applied on the next refresh/restart.
- Plugin config still uses the existing `canvas-plugins.json` storage behavior; the market state must not be treated as a secret vault.
- MCP Apps support inline and right-Dock fullscreen modes in chat, embedded canvas nodes, and main-area global apps from the Sidebar. Global apps have no item menu yet (place on canvas, hide), no persisted running state, and no persisted Agent view context. Mounted canvas nodes and the active global App expose bounded text/structured view context; inline-chat App context updates, binary image context, persisted UI snapshots, PiP, deep links, and file entrypoints are not yet supported.
