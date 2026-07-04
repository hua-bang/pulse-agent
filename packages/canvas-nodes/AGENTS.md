# AGENTS.md - packages/canvas-nodes

> Local entry for `packages/canvas-nodes`.
> Repository harness entry: `../../harness/README.md`.

## Module Positioning

`@pulse-canvas/nodes` owns runtime-loadable external node plugins for Pulse
Canvas. The current package contributes the `pulse-canvas-nodes` plugin and the
`excalidraw.board` node type, including:

- an Electron-main capability provider for semantic read/write/action behavior,
- a Module Federation renderer shell,
- an isolated Excalidraw `<webview>` app,
- compact scene helpers for agent-authored boards,
- agent skill guidance for creating and modifying board nodes.

This package is intentionally loaded as a plugin directory. The Canvas host
should discover it through `manifest.json` and plugin loading, not by importing
package internals directly.

## Knowledge Navigation

| Task | Read |
|---|---|
| Repository harness and root validation | `../../harness/README.md`, `../../harness/validate/validation.yaml` |
| Package overview and install flow | `README.md` |
| Plugin manifest and public contract | `manifest.json` |
| Build outputs and MF settings | `vite.config.ts`, `vite.webview.config.ts`, `vite.main.config.ts` |
| Plugin ids and node type constants | `src/constants.ts` |
| Host/plugin TypeScript contracts | `src/types.ts` |
| Main-process capabilities and tools | `src/main.ts` |
| Renderer plugin registration | `src/plugin.tsx` |
| Excalidraw renderer shell | `src/ExcalidrawNodeView.tsx`, `src/ExcalidrawNodeView.css` |
| Isolated Excalidraw webview app | `src/webview-app.tsx`, `src/webview-app.css`, `index.html` |
| Scene normalization/actions | `src/scene.ts` |
| Tests | `src/__tests__/main.test.ts`, `src/__tests__/scene.test.ts` |
| Agent-facing node guidance | `skills/excalidraw-node/SKILL.md` |
| Canvas host plugin contract | `../../apps/canvas-workspace/docs/plugin-node-mf2.md`, `../../apps/canvas-workspace/AGENTS.md` |
| Local validation | `harness/validate/validation.yaml` |

There is no package-local documentation beyond the local validation file. Use
the root harness files and the Canvas host docs when behavior crosses into the app.

## Local Constraints

- Preserve the plugin identity `pulse-canvas-nodes` and node type
  `excalidraw.board` unless coordinating a host/plugin contract change.
- Keep the manifest as the public package contract: main entry
  `dist/main.js`, renderer entry `dist/mf-manifest.json`, webview entry
  `dist/index.html`, actions, capabilities, and skill metadata must stay in
  sync with source.
- Host canvas nodes stay `type: "plugin"` with `data.pluginId`,
  `data.nodeType`, and plugin-owned `data.payload`. The host should treat
  Excalidraw scene data as opaque except through registered capabilities.
- Keep Excalidraw scene data under `node.data.payload`; use `src/scene.ts` for
  normalization, skeleton conversion, summaries, replacement, and append
  behavior.
- Renderer shell code should communicate with the isolated board through the
  webview bridge and host preload APIs. Do not reach into
  `apps/canvas-workspace` internals.
- The renderer build relies on host-provided singleton React/React DOM via
  Module Federation. Be cautious changing shared dependency settings.
- Contract changes to manifest shape, node actions, tool schemas, renderer
  plugin props, or payload shape should route through
  local validation and usually require host-side checks.

## Common Commands

```bash
pnpm --filter @pulse-canvas/nodes test
pnpm --filter @pulse-canvas/nodes typecheck
pnpm --filter @pulse-canvas/nodes build
```

Surface-specific builds are available when narrowing a packaging issue:

```bash
pnpm --filter @pulse-canvas/nodes build:renderer
pnpm --filter @pulse-canvas/nodes build:webview
pnpm --filter @pulse-canvas/nodes build:main
```

## Key Files

- `manifest.json`: plugin id, main entry, node registration, renderer entry,
  actions, capabilities, and skill metadata.
- `src/main.ts`: main-process node capabilities and
  `excalidraw_board_template` tool registration.
- `src/plugin.tsx`: renderer-side node view registration.
- `src/ExcalidrawNodeView.tsx`: host renderer shell that mounts, sizes,
  registers, and syncs the webview.
- `src/webview-app.tsx`: isolated Excalidraw app and bridge surface.
- `src/scene.ts`: scene normalization, skeleton conversion, patching, and
  summaries.
- `src/types.ts`: host/plugin contracts mirrored by the Canvas workspace.
- `skills/excalidraw-node/SKILL.md`: agent guidance for board node workflows.
