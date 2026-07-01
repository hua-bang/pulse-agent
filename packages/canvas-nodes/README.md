# Pulse Canvas Nodes

Runtime-loadable external node plugins for Pulse Canvas.

This package is intentionally not imported by `apps/canvas-workspace`. Build it,
then add this directory in Pulse Canvas Settings -> Plugins.

```bash
pnpm --filter @pulse-canvas/nodes build
```

Add the plugin directory:

```text
/Users/jasperhu/project/pulse-agent/packages/canvas-nodes
```

The root `manifest.json` points the host at:

- `dist/mf-manifest.json` for the React/MF2 renderer
- `dist/main.js` for the Electron main plugin
- `skills/excalidraw-node/SKILL.md` for Agent guidance

The isolated Excalidraw webview app is not a manifest field. The renderer shell
resolves its URL at runtime (`ExcalidrawNodeView.resolveWebviewAppUrl`) as
`../index.html` relative to the renderer bundle, landing on `dist/index.html` in
the build output.

## Excalidraw Board

Node type:

```text
pluginId: pulse-canvas-nodes
nodeType: excalidraw.board
```

The board stores its scene in `node.data.payload`:

```json
{
  "title": "System sketch",
  "elements": [],
  "appState": {
    "viewBackgroundColor": "#ffffff"
  },
  "files": {}
}
```

Agents should create this as a plugin node with `canvas_create_node`, then drive
it through `canvas_plugin_node_action`. The registered actions are `set_scene`,
`append_elements`, `add_text`, `clear_scene`, and `summarize`; see
`skills/excalidraw-node/SKILL.md` for each action's input shape.

The plugin also registers the `excalidraw_board_template` canvas tool, which
generates a compact skeleton payload for `canvas_create_node` `data.payload` or
`canvas_plugin_node_action` `action="set_scene"`.

The renderer shell is loaded through Module Federation, but the board itself
runs in an Electron `<webview>`. The shell registers that webview against the
canvas node id, so host-side readers and CDP/page-control tools can operate on
the live Excalidraw surface without coupling the host app to
`@excalidraw/excalidraw`. Those page-control tools live in the Canvas host
(`apps/canvas-workspace/src/plugins/main/webview-page-control/`) and are gated
by the experimental `webview-page-control` flag — when the flag is off the agent
never sees the tool names.

## Development

```bash
pnpm --filter @pulse-canvas/nodes build          # build:renderer + build:webview + build:main
pnpm --filter @pulse-canvas/nodes test           # vitest run
pnpm --filter @pulse-canvas/nodes typecheck      # tsc --noEmit
```

Surface-specific builds, useful when narrowing a packaging issue:

```bash
pnpm --filter @pulse-canvas/nodes build:renderer
pnpm --filter @pulse-canvas/nodes build:webview
pnpm --filter @pulse-canvas/nodes build:main
```
