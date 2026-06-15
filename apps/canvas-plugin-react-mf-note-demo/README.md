# React MF Note Plugin Demo

This folder is intentionally outside `src/plugins`. It simulates a user-owned
React plugin package that Pulse Canvas can load from Settings -> Canvas Plugins.

## Try It In Pulse Canvas

1. Build the remote after installing this demo's own dependencies:

   ```bash
   cd apps/canvas-plugin-react-mf-note-demo
   pnpm install --ignore-workspace
   pnpm build
   ```

2. Open Pulse Canvas.
3. Go to Settings -> Canvas Plugins.
4. Choose this folder:

   ```txt
   apps/canvas-plugin-react-mf-note-demo
   ```

The host reads `manifest.json` and loads `dist/remoteEntry.js`.
This repository keeps the built `dist/remoteEntry.js` in the demo folder, so
you can also load it immediately before changing the source.

## Create A Demo Node

This demo contributes the node type `demo.note`. You can ask the Canvas Agent to
create a plugin node with:

```json
{
  "type": "plugin",
  "title": "Demo Note",
  "width": 380,
  "height": 280,
  "data": {
    "pluginId": "demo-note",
    "nodeType": "demo.note",
    "payload": {
      "title": "External React plugin",
      "body": "Loaded from a user-configured local directory.",
      "accent": "#2383e2",
      "pinned": false
    }
  }
}
```

The current host MVP loads the renderer side from external directories. Main
process read/write/action capabilities for third-party packages are a later
sandboxing step.

## Project Shape

```txt
manifest.json
package.json
vite.config.ts
src/
  NoteNodeView.tsx
  plugin.tsx
  preview.tsx
  remote-entry.ts
  types.ts
dist/
  remoteEntry.js
```

`remote-entry.ts` wraps the React plugin in the Module Federation global remote
shape that the current Canvas host loads:

```ts
globalThis.pulse_canvas_demo_note = {
  init() {},
  get('./plugin') {
    return Promise.resolve(() => ({ default: plugin }));
  },
};
```

React is treated as a host-provided external global:

```ts
__PULSE_CANVAS_PLUGIN_REACT__
```

That keeps the demo small and aligned with the current `type: "global"` loading
path.
