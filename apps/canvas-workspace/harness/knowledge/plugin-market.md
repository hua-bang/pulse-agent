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
| Canvas plugin directory/config SSOT and skill sources | `src/main/settings/canvas-plugins-config.ts` |
| IPC registration and preload bridge | `src/main/plugin-market/ipc.ts`, `src/preload/bridge/plugin-market.ts`, `src/preload/index.ts` |
| Route, state, filters, rows and dialogs | `src/renderer/src/views/PluginMarket/`, wired by `src/renderer/src/App.tsx` |
| Installed-plugin `@` mentions and request-context collection | `src/renderer/src/components/chat/hooks/pluginMentionItems.ts`, `useMentions.ts` |
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
| `plugin-market:connect-mcp` | `connectMcp(listingId)` | Start client-managed OAuth for the first disconnected remote MCP server. |
| `plugin-market:set-native-enabled` | `setNativeEnabled(listingId, enabled)` | Change the separate Pulse native-extension trust bit. |
| `plugin-market:choose-directory` | `chooseDirectory()` | Link a user-selected local package. |
| `plugin-market:add-git` | `addGit(source)` | Clone and install a validated HTTPS Git source. |

Every operation returns JSON-safe data from `src/shared/plugin-market.ts`. Renderer code has no Electron/Node access; browsing a source uses the existing typed shell preload API.

The Plugins and Skills library routes reserve the expanded RightDock width instead of letting it overlay page content. Plugin rows use a container query against the remaining page width, so the catalog is two columns when space permits and one column beside a wide dock. Plugin details use a route-scoped dialog: its backdrop and card stay inside the Plugins surface, omit global `aria-modal` semantics, and do not trap keyboard focus away from the persistent RightDock. `Connect` keeps the details visible for connection status while the OAuth link tab opens alongside it in the dock.

## Chat mention semantics

The chat `@` picker offers healthy installed market listings in a dedicated Plugins group. Selecting one serializes a stable `@[plugin:<encoded-listing-id>|<encoded-name>]` marker and adds `{ id, name }` to `AgentRequestContext.plugins`; turn snapshots preserve the same refs for regenerate/replay. The marker renders as a plugin chip in both the composer and transcript.

An `@Plugin` is an explicit turn-level routing preference and scope hint. It does not force a tool call, connect a plugin, disable unrelated tools, or replace the agent's default ability to choose plugins automatically. When the request benefits from the selected package, the system prompt tells the agent to prefer that package's already-loaded skills or MCP tools; unavailable or disconnected capabilities must degrade honestly. Only installed listings without package-read errors are mentionable. Renderer discovery uses the existing `pluginMarket.list()` API and a short cache, so typing in the composer does not introduce a second plugin registry.

## Catalog semantics

`PluginMarketListing.installState` is authoritative for the UI:

- `available`: Pulse has an install adapter and may offer `Install`;
- `installed`: the package is registered in `canvas-plugins.json` and represented in the market snapshot;
- `unsupported`: discovery only; the UI offers `Explore` and opens the Git source.

The launch catalog contains six reviewed, installable Agent Plugins v1 packages: Exa, TranscriptAPI, Arcade, Resend, OpnForm and Mobbin. Each entry points to a concrete package root that passes the strict reader; OpnForm uses a repository subdirectory. The catalog is intentionally small and compiled into the app because Agent Plugins defines package structure, not discovery or marketplace governance. Do not mark a repository installable merely because it contains reusable skills or a file named `plugin.json`.

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
The market renderer then reads the execution-authoritative Canvas plugin status, dispatches the shared plugins-changed event, and reconciles renderer federation registrations so disabling or uninstalling a native extension removes its routes, navigation items, chat cards, and node views from the live window.

## MCP adapter

The v1 reader accepts stdio, streamable HTTP and SSE servers after validating the closed MCP schema.

- `./` stdio commands and cwd paths are resolved to canonical package-contained paths; bare executable names are allowed for PATH lookup.
- `${PLUGIN_ROOT}` and `${PLUGIN_DATA}` are the only plugin runtime placeholders. The adapter expands them in args/env/cwd and injects both environment variables; plugin env cannot override them.
- Server config keys become `<safe-plugin-name>.<server-name>` to reduce collisions. The engine preserves that key for status and OAuth lookup, but normalizes punctuation in the model-visible tool name (for example `mcp_exa.exa_search` becomes `mcp_exa_exa_search`).
- `streamable-http` maps to Pulse `http`; `sse` remains `sse`.
- Remote URLs must be HTTP(S), with plain HTTP limited to loopback. User information and fragments are rejected.
- Public literal headers are preserved, but credential-bearing names such as `Authorization`, `Cookie`, `Proxy-Authorization`, `X-API-Key` and `API-Key` are rejected. Cross-origin redirect header stripping remains the transport layer's responsibility.
- A remote server is exposed as `connectable` until the Canvas OAuth store reports a valid connection. The market detail view starts the existing client-managed OAuth flow; the engine only injects the OAuth provider after that connection exists, avoiding accidental dynamic registration during ordinary MCP discovery.
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

## Validation entry points

Let the repository runner select the bound Canvas checks for a change:

```bash
node scripts/harness/run-harness-check.mjs --path apps/canvas-workspace/src/main/plugin-market apps/canvas-workspace/src/shared/plugin-market.ts apps/canvas-workspace/src/preload/bridge/plugin-market.ts apps/canvas-workspace/src/renderer/src/views/PluginMarket
```

Focused iteration:

```bash
pnpm --filter canvas-workspace exec vitest run src/main/plugin-market src/main/settings/__tests__/canvas-plugins-config.test.ts src/renderer/src/views/PluginMarket
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
