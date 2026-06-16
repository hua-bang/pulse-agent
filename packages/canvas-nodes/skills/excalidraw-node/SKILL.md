---
name: excalidraw-node
description: Create, read, and modify Excalidraw board plugin nodes in Pulse Canvas.
---

# Excalidraw Board Node

Use this skill when the user wants a hand-drawn diagram, architecture sketch,
flow, map, or visual explanation inside Pulse Canvas.

## Node Identity

Create Excalidraw boards as plugin nodes:

```json
{
  "type": "plugin",
  "title": "Architecture Sketch",
  "data": {
    "pluginId": "pulse-canvas-nodes",
    "nodeType": "excalidraw.board",
    "payload": {
      "title": "Architecture Sketch",
      "elements": [],
      "appState": {
        "viewBackgroundColor": "#ffffff"
      },
      "files": {}
    }
  }
}
```

The visual board runs inside a registered Electron webview. Prefer semantic
node actions for scene changes, but DOM/CDP page tools can inspect or operate
the live Excalidraw UI when the node is mounted.

## Preferred Workflow

1. If no board exists, call `canvas_create_node` with the plugin node identity
   above.
2. Read the board before changing it with `canvas_plugin_node_read`.
3. Use `canvas_plugin_node_action` rather than direct payload writes whenever
   possible.
4. Prefer simple skeleton elements. The plugin converts them into Excalidraw
   scene elements.

## Actions

Use `canvas_plugin_node_action` with:

- `set_scene`: replace the scene. Input accepts `title`, `backgroundColor`,
  `elements`, or `skeleton`.
- `append_elements`: append elements. Input accepts `elements` or `skeleton`.
- `add_text`: add a text element. Input accepts `text`, `x`, `y`, `fontSize`.
- `clear_scene`: remove all elements.
- `summarize`: return a structured board summary without changing it.

## Skeleton Schema

Skeleton elements are intentionally compact:

```json
[
  {
    "type": "rectangle",
    "x": 80,
    "y": 80,
    "width": 220,
    "height": 96,
    "text": "User request",
    "backgroundColor": "#e7f0ff",
    "strokeColor": "#2457a6"
  },
  {
    "type": "arrow",
    "x": 310,
    "y": 128,
    "width": 120,
    "height": 0,
    "text": "flows to"
  }
]
```

Supported `type` values: `rectangle`, `ellipse`, `diamond`, `text`, `arrow`,
and `line`.

For diagram clarity:

- Keep labels short.
- Use left-to-right or top-to-bottom flow.
- Use fewer than 30 elements unless the user asks for a detailed diagram.
- Put long explanations in nearby text/file nodes, not inside the board.
