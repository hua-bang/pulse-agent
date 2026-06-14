# Plugin Node Contract

This is the first vertical slice for custom canvas nodes. A custom node keeps a
stable host-owned canvas type and delegates view/semantics to a plugin:

```ts
{
  type: 'plugin',
  data: {
    pluginId: 'mock',
    nodeType: 'mock.card',
    payload: {}
  }
}
```

The renderer resolves `data.nodeType` through the renderer plugin registry. The
main process resolves the same `data.nodeType` through a capability registry so
the Canvas Agent can read, write, and execute plugin-owned behavior.

## Renderer Shape

Expose a module, usually `./plugin`, that exports a `RendererCanvasPlugin`:

```ts
export default {
  id: 'figma',
  activate(ctx) {
    ctx.registerNodeView('figma.frame', FigmaFrameNodeView);
  },
};
```

`FigmaFrameNodeView` receives `PluginNodeViewProps`:

```ts
{
  node,
  workspaceId,
  workspaceName,
  readOnly,
  selected,
  updateNode(patch),
  invoke(channel, ...args)
}
```

`updateNode` writes host-owned canvas state. `invoke` calls the matching
main-side plugin channel.

## Main Capability Shape

Main-side plugins register semantic capabilities:

```ts
export default {
  id: 'figma',
  activate(ctx) {
    ctx.registerNodeCapabilities('figma.frame', {
      read({ node }) {
        return { content: 'Readable text for the Agent', data: node.data };
      },
      write({ node }, input) {
        return { payload: input.payload };
      },
      actions: {
        sync({ node }, input) {
          return { result: { ok: true }, patch: { payload: { syncedAt: Date.now() } } };
        },
      },
    });
  },
};
```

Host tools exposed to the Canvas Agent:

- `canvas_read_node`: automatically delegates to plugin `read`.
- `canvas_plugin_node_read`: structured plugin read.
- `canvas_plugin_node_write`: write through plugin validation/normalization.
- `canvas_plugin_node_action`: execute a named action and persist its returned patch.

## Dev Loading

In development, pass remote renderer specs through
`VITE_CANVAS_RENDERER_MF_REMOTES`:

```bash
VITE_CANVAS_RENDERER_MF_REMOTES='[
  {
    "id": "figma",
    "name": "figma_node",
    "entry": "http://127.0.0.1:3001/remoteEntry.js",
    "expose": "./plugin",
    "type": "global",
    "entryGlobalName": "figma_node"
  }
]' pnpm --filter canvas-workspace dev
```

The built-in mock plugin lives at `src/plugins/mock-node`. Its renderer bundle
source is `src/plugins/mock-node/renderer/remoteEntry.js`. The plugin manifest
uses the package-local path `renderer/remoteEntry.js`; the host scans local
plugin manifests and resolves that to the runtime URL
`/plugins/mock-node/remoteEntry.js` so `mock.card` still loads through the same
MF2 runtime path.
