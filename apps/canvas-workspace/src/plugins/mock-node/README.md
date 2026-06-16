# Mock Node Plugin

This is the first custom canvas node plugin slice.

- `manifest.json` describes the package shape we want third-party plugins to converge on.
- `constants.ts` keeps the plugin id, node type, and renderer remote identity in one place.
- `main.ts` registers `mock.card` and `mock.todo-list` read/write/action capabilities for the Canvas Agent.
- `manifest.json` uses package-local paths, so `renderer.entry` points to
  `renderer/remoteEntry.js`.
- The host scans local plugin manifests and serves/copies that renderer entry to
  `/plugins/mock-node/remoteEntry.js` in dev/build for the MF2 runtime.

Persisted canvas nodes stay generic:

```json
{
  "type": "plugin",
  "data": {
    "pluginId": "mock",
    "nodeType": "mock.card",
    "payload": {
      "text": "Hello from a plugin node",
      "count": 0
    }
  }
}
```

The renderer owns the views. The main half owns the semantic capabilities:

- `read`: returns content the Agent can summarize.
- `write`: validates and normalizes payload patches.
- `action.increment`: mutates the count through an executable capability.
- `action.add_item` / `toggle_item` / `clear_completed`: operate the Todo List node.
