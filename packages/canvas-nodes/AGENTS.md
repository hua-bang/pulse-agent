# AGENTS.md - packages/canvas-nodes

> Local entry for `packages/canvas-nodes`.
> Repository harness entry: `../../harness/README.md`.

## Module Positioning

`@pulse-canvas/nodes` owns runtime-loadable external node plugins for Pulse Canvas. The current package provides the `pulse-canvas-nodes` plugin and the `excalidraw.board` node type, including main-process capabilities, a Module Federation renderer shell, an isolated Excalidraw webview app, and agent skill guidance.

This package is intentionally loaded as a plugin directory. `apps/canvas-workspace` should discover it through `manifest.json` and runtime plugin loading rather than importing package internals directly.

## Knowledge Navigation

| Task | Read |
|---|---|
| Package overview and install flow | `README.md` |
| Plugin manifest | `manifest.json` |
| Main-process plugin capabilities | `src/main.ts` |
| Renderer plugin registration | `src/plugin.tsx` |
| Excalidraw node shell | `src/ExcalidrawNodeView.tsx`, `src/ExcalidrawNodeView.css` |
| Isolated webview app | `src/webview-app.tsx`, `src/webview-app.css` |
| Scene normalization/actions | `src/scene.ts`, `src/types.ts` |
| Tests | `src/__tests__/` |
| Agent-facing node guidance | `skills/excalidraw-node/SKILL.md` |
| Canvas host guidance | `../../apps/canvas-workspace/AGENTS.md` |
| Documentation routing | `../../harness/skills/doc-governance.md` |
| Validation planning | `../../harness/skills/quality-workflow.md` |

## Local Constraints

- Keep host and plugin boundaries clean: expose behavior through `manifest.json`, plugin activation, node capabilities, and registered tools.
- Preserve the node identity `pluginId: pulse-canvas-nodes` and `nodeType: excalidraw.board` unless coordinating a contract change.
- Keep Excalidraw scene data under `node.data.payload`; use scene helpers for normalization, skeleton conversion, summaries, and patches.
- Renderer shell code should communicate with the isolated board through the webview bridge and host preload APIs, not by reaching into canvas app internals.
- Contract changes to manifest shape, node actions, tool schemas, or payload shape should route through `../../harness/skills/contract-coding.md`.

## Common Commands

```bash
pnpm --filter @pulse-canvas/nodes test
pnpm --filter @pulse-canvas/nodes typecheck
pnpm --filter @pulse-canvas/nodes build
```

## Key Files

- `manifest.json`: plugin id, main entry, node registration, renderer entry, actions, and skill metadata.
- `src/main.ts`: main-process node read/write/action capabilities and `excalidraw_board_template` tool registration.
- `src/plugin.tsx`: renderer-side node view registration.
- `src/ExcalidrawNodeView.tsx`: host renderer shell that mounts and syncs the webview.
- `src/webview-app.tsx`: isolated Excalidraw app and bridge surface.
- `src/scene.ts`: scene normalization, skeleton conversion, patching, and summaries.
- `skills/excalidraw-node/SKILL.md`: agent guidance for creating and modifying board nodes.
