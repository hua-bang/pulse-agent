---
name: add-canvas-node
description: Use when adding a new canvas node capability to Pulse Canvas (apps/canvas-workspace) — either a first-class host node type or a plugin node type. Covers choosing the path, the exact touch points for each, and the landmines (union/factory desync, dispatch fallthrough, agent-tool contract surface).
---

# Add a Canvas Node

An ordered procedure for adding a new node capability. Gives the SEQUENCE and the landmines; FACTS live in the knowledge docs it points to — do not restate them here.

## Step 0 — choose the path (read this before writing code)

Two extension paths coexist and **the criterion for choosing between them is undecided** — see `../../spec/node-extension-path.md`. Until that spec is resolved:

- `AGENTS.md` Local Constraints leans **plugin-ward**: "Host behavior should go through renderer/main plugin registries and declared capabilities."
- But the host union has kept growing anyway (`mindmap`, `shape`, `reference`, `dynamic-app` all became host types after the plugin mechanism existed) — so plugin-ward is a stated preference, not an enforced rule.
- **Default to the plugin path (Step 2) unless you have a concrete reason the plugin capability model can't carry it** (e.g. the node needs a dedicated main-process subsystem like PTY sessions or its own storage-migration path — the shape terminal/agent nodes needed). If you take the host-type path, say why in your PR — you're taking on a heavier, schema-visible commitment (Step 1) that the repo's own guidance leans against.
- If you hit a case that makes you genuinely unsure which path is right, that uncertainty IS the evidence the spec needs — add it to the spec's open question rather than silently picking one.

## Step 1 — host type (the heavy path)

Four touch points, all required, in this order:

1. **`src/shared/canvas.ts`** — add the type string to `CanvasNode['type']`'s union, and add the node's `data` shape to the `data` union (a new `XxxNodeData` interface).
2. **`src/renderer/src/utils/nodeFactory.ts`** — add a `case` to `createNodeData(type)` returning the default data shape. `describe-canvas.mjs` (Step 4) fails the build if this falls out of sync with the type union — **a type with no factory case is a hard error, not a warning**. If the node should NOT be user-creatable from the menu (e.g. it's only ever materialized programmatically, like `dynamic-app` from `dynamic_app_create` — see the sentinel-shape comment at `nodeFactory.ts` near the `dynamic-app` case), leave it out of the `CreatableCanvasNodeType` union (same file) so it doesn't appear in `NodeContextMenu`/`FloatingToolbar`/`CanvasOverlays`'s creation menus, but it still needs a `createNodeData` case for the union/factory sync check.
3. **Renderer dispatch — read the fallthrough chain carefully, it is NOT one switch statement:**
   - `src/renderer/src/components/CanvasNodeView/index.tsx` short-circuits FIRST for `image`/`shape`/`reference`/`mindmap` (each returns its own dedicated body component directly).
   - Everything else falls through to `DefaultCanvasNode` (`CanvasNodeView/DefaultCanvasNode.tsx`), which has its OWN internal `node.type ===` chain dispatching to `FileNodeBody`/`TerminalNodeBody`/frame-or-group/`text`/`iframe`/`dynamic-app`/`plugin` body components (most lazy-loaded).
   - A new host type needs a branch in ONE of these two places (pick whichever pattern your new type's siblings use) — missing this renders nothing for the new type, silently.
4. **Persistence compatibility** — node data round-trips through workspace JSON (`src/main/canvas/storage.ts`). New fields must be JSON-safe; this is NOT the same as `CANVAS_SCHEMA_VERSION_V2` (that version gates the overall v1→v2 canvas file format, not individual node types — you do not need to bump it for a new node type).

Also touches the agent-tool contract surface if the Canvas Agent should be able to create/read/write the new type — see `harness/knowledge/tools-reference` equivalent for canvas: `src/main/agent/tools/nodes.ts` (`canvas_create_node`) and `node-read-tools.ts` (`canvas_read_node`) generally handle host types generically via the shared `data` shape, but check whether your new type needs a dedicated read/write branch.

## Step 2 — plugin node (the light path)

Full contract: `../../knowledge/plugin-node-mf2.md`. Summary of the shape (do not restate the doc's detail here, read it):

- Host type stays the stable `'plugin'` sentinel; your node's identity is `data.nodeType` (e.g. `'figma.frame'`), resolved through renderer + main plugin registries — no touch to `shared/canvas.ts`, `nodeFactory.ts`'s union, or the `CanvasNodeView` dispatch chain at all.
- Renderer: export a `RendererCanvasPlugin` that calls `ctx.registerNodeView('your.type', YourNodeView)`.
- Main: export a plugin that calls `ctx.registerNodeCapabilities('your.type', { read, write, actions })` — this is what wires `canvas_plugin_node_read`/`_write`/`_action` for the Canvas Agent.
- Dev-load your plugin via a local manifest under `canvas-plugins.json` (`pluginDirs`) before wiring a permanent built-in manifest under `src/plugins/*/manifest.json` — see the doc's "Dev Loading" section. `src/plugins/mock-node/` is the working reference implementation (two node types, both patterns).

## Step 3 (both paths) — verify against ground truth, not memory

```bash
node apps/canvas-workspace/harness/tools/describe-canvas.mjs
```

Confirms: the type union and `createNodeData` factory are in sync (host-type path — exits non-zero if not), and dumps the current agent-tool registry so you can check whether your new tool name collides or whether an existing generic tool already covers your type. Run this BEFORE you start, not just after — the tool/type inventory it prints is more current than any prose description of "current node types," including this skill.

## Step 4 — run the checks

```bash
pnpm --filter canvas-workspace typecheck
pnpm --filter canvas-workspace test
```

If the new type/plugin touches shared UI (buttons, menus, dialogs), it is governed by the UI-reuse ratchet — see `../../knowledge/conventions/frontend.md` ("UI reuse (governed)"); reuse `components/ui/` rather than hand-rolling controls, or `pnpm test` will fail on the counters.

## Done when

`describe-canvas.mjs` reports union/factory in sync (host-type path) or your plugin's tools appear in its registry dump (plugin path); the node renders via one of the two dispatch points and creates from the menu if it should; `typecheck` + `test` are green.
