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
- `dist/index.html` for the isolated Excalidraw webview app
- `skills/excalidraw-node/SKILL.md` for Agent guidance

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

Agents should create this as a plugin node with `canvas_create_node`, then use
`canvas_plugin_node_action` with `set_scene` or `append_elements`.

The renderer shell is loaded through Module Federation, but the board itself
runs in an Electron `<webview>`. The shell registers that webview against the
canvas node id, so host-side readers and future CDP/page-control tools can
operate on the live Excalidraw surface without coupling the host app to
`@excalidraw/excalidraw`.
