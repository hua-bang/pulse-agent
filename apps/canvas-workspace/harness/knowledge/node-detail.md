# Node Detail (knowledge-node detail surface)

Node Detail is the reading/editing surface for a knowledge-node record — a
knowledge atom (no `x`/`y`/`width`/`height`), not a canvas node with spatial
layout. Read this before changing the panel/host split, the
`RightDock.enterNodePage` contract, the record→CanvasNode adapter, the
`nodeDetailDescriptor.ts` surface table, save-failure handling, deleted-node
semantics, cross-surface navigation, Escape ownership, or the
`KnowledgeChatPortal` memoization rule.

## One panel, two hosts — and why the dock is primary

There is ONE panel component,
`src/renderer/src/modules/workspace-nodes/internal/NodeDetailPanel.tsx`, rendered by
TWO hosts:

- the `/nodes/<ws>/<id>` page route
  (`src/renderer/src/modules/workspace-nodes/internal/NodeDetailPage.tsx`);
- the dock tab
  (`src/renderer/src/components/dock/RightDock/NodeDetailDockTab.tsx`, which
  renders the panel with `mode="dock"`).

The dock is the primary entry point: list cards, graph nodes, and note
mentions all open a dock tab — the page is the drill-down from there, not the
default landing surface. Consequently, a reading aid (or any other piece of
UI) that renders only when `mode === 'page'` is invisible to most users, who
never leave the dock. Concretely, `NodeDetailPanel` renders the AI-summary
"reading aid" inline only in dock mode and hands it to the page's
`NodeDetailContextRail` (`mode === 'page'`) instead of duplicating the
page-only condition — the panel is written so the aid is reachable from both
hosts rather than gated behind the less-visited one.

`NodeDetailPanel` takes a `mode?: 'page' | 'dock'` prop (default `'dock'`)
and switches several sibling components on it and on the descriptor's
`layout` (see below): the back button, the inline AI-insight block, whether
`NodeDetailSupplementary` (Relations/Info disclosures) renders, and whether
the page-only `NodeDetailContextRail` renders.

## Entering the page: the `RightDock.enterNodePage` contract

Entering a full-page detail MUST go through `RightDock.enterNodePage`
(`src/renderer/src/components/dock/RightDock/dock-store.ts`). Its contract:

- it removes the matching dock tab (the node's dock preview and its full
  page are mutually exclusive — the same node should not show twice);
- it collapses the dock ONLY when that matching preview was the active tab;
- an unrelated active dock tab stays visible — page promotion must never
  discard the user's other open context.

In the current implementation this is:

```ts
enterNodePage(workspaceId: string, nodeId: string): void {
  const id = nodeDetailTabId(workspaceId, nodeId);
  const promotedActivePreview = this.state.expanded && this.state.activeTabId === id;
  this.close(id);
  if (promotedActivePreview) this.collapse();
}
```

Bound test: `src/renderer/src/components/dock/RightDock/__tests__/dock-store.test.ts`.

## Subject and rendering: `WorkspaceNodeRecord` → `CanvasNode`

The panel's subject is a `WorkspaceNodeRecord` (the knowledge atom; no
`x`/`y`/`width`/`height`), not a `CanvasNode`. It is rendered through the
real `CanvasNodeView` so a knowledge node reuses the exact same node body
components the canvas itself uses, rather than a parallel read-only
renderer:

- `src/renderer/src/modules/workspace-nodes/internal/NodeCanvasPreview.tsx` adapts
  record → `CanvasNode` (constructs a `CanvasNode`-shaped object from the
  record's `id`/`type`/`title`/`data`/`properties`/`links`/`updatedAt`, plus
  a measured `width`/`height` from a `ResizeObserver`) and renders it via
  `CanvasNodeView` with `embedded hideHeader`.
- Layout fields (`x`/`y`/`width`/`height`/ref) live only in this preview —
  any patch targeting those fields is dropped before it reaches the
  workspace-node store; only `title`, `data`, `properties`, and `links` are
  writable (`WritablePatch` in `NodeCanvasPreview.tsx`).

## `nodeDetailDescriptor.ts`: the surface SSOT

`src/renderer/src/modules/workspace-nodes/internal/nodeDetailDescriptor.ts` is the
single source of truth for type → surface/layout/capability. Callers never
pass a second, potentially contradictory presentation string — every host
asks this one table.

Current shape (`NodeDetailDescriptor`): `surface: 'document' | 'web' |
'mindmap'`, `layout: 'document' | 'workspace'`, `metadata: 'inline' |
'inspector'`, `selectEmbeddedNode: boolean`, `backgroundPan: boolean`.
`getNodeDetailDescriptor(type)` returns `WEB_DETAIL` for `'iframe'`,
`MINDMAP_DETAIL` for `'mindmap'`, and `DOCUMENT_DETAIL` otherwise.

Policy per type:

- **File/Text and other document-like records** use the generic document
  layout (`layout: 'document'`, `metadata: 'inline'`) — plain metadata
  inline, no rich embedded surface.
- **Web (`iframe`) and Mindmap** are rich working surfaces
  (`layout: 'workspace'`, `metadata: 'inspector'`): the real node body fills
  the remaining area, compact metadata lives behind the header Info
  inspector instead of inline, and generic Relations/Info/context-rail
  chrome stays absent for these types.
  - `NodeDetailPanel` derives `isRichDetail = detail.layout === 'workspace'`
    and gates `NodeDetailSupplementary` (Relations/Info disclosures) and the
    page-only `NodeDetailContextRail` behind `!isRichDetail`; it also adds
    `node-detail-panel--rich node-detail-panel--<surface>` classes when rich.
  - The Info inspector itself lives in
    `src/renderer/src/modules/workspace-nodes/internal/NodeDetailHeader.tsx`
    (`metadata === 'inspector'` branch, backed by
    `NodeDetailInspector.tsx`).
- **Web** retains its iframe navigation bar.
- **Mindmap** retains selected-topic editing, pointer-event background pan,
  keyboard pan, and an explicit center action — see the `mindmapPan`
  handlers (`onPointerDown`/`onPointerMove`/`onPointerUp`/
  `onPointerCancel`/`onLostPointerCapture`/`onKeyDown`, and the center
  `Button`) wired in `NodeCanvasPreview.tsx` via
  `src/renderer/src/modules/workspace-nodes/internal/useMindmapDetailPan.ts`.

## Save failures: the adapter must never reject into a node body

The canvas's own `onUpdate` contract never rejects. Every node body is
written against that non-rejecting contract and calls `onUpdate`
fire-and-forget — confirmed in `TextNodeBody`, `MindmapNodeBody`, and
`IframeNodeBody` (`src/renderer/src/components/node-bodies/TextNodeBody/index.tsx`,
`src/renderer/src/components/node-bodies/MindmapNodeBody/index.tsx`,
`src/renderer/src/components/node-bodies/IframeNodeBody/index.tsx`). If
`NodeCanvasPreview`'s adapter rejected on a failed record write, that
rejection reached nobody and surfaced only as an unhandled promise
rejection — worse, the pre-fix behavior of re-reading the stored record on
failure actively discarded exactly the edit that had failed to save (the one
thing the user cannot retype from the UI).

The fix, in `commitPatch` / `retryFailedSave` / `discardFailedSave`
(`src/renderer/src/modules/workspace-nodes/internal/NodeCanvasPreview.tsx`):

- a failed record write HOLDS the optimistic content on screen (it is never
  reverted to the last-known-good record);
- external change events are refused/ignored while a failure is held
  (`updatePendingRef` / `failedPatchRef` gate the record-sync effect);
- the panel shows a retry/discard banner
  (`src/renderer/src/modules/workspace-nodes/internal/NodeCanvasSaveError.tsx`);
- a further failure while one is already pending is merged into the same
  pending patch via `mergePatches`, so retry replays every unsaved change,
  not just the last keystroke.

`FileNodeBody`'s own `.note-save-status` UI
(`src/renderer/src/components/node-bodies/FileNodeBody/index.tsx`,
`src/renderer/src/components/node-bodies/FileNodeBody/index.css`) reports *file* writes
— a disjoint failure from the *record* write above, so both can be visible
at once without one hiding the other.

Bound test:
`src/renderer/src/modules/workspace-nodes/internal/__tests__/NodeCanvasPreview.test.tsx`
(save-failure + rich-presentation guards).

## Deleted-node "missing" semantics

The `workspace-node:read` IPC answers a deleted node with `ok: true` and NO
record — this is indistinguishable from "nothing selected" unless a caller
tracks it explicitly.
`src/renderer/src/modules/workspace-nodes/internal/useWorkspaceNodes.ts`'s
`useWorkspaceNode` exposes that case as a separate `missing` boolean. A host
that conflates `missing` with "nothing selected" tells someone their deleted
node is merely unselected, which is misleading. The dock tab
(`NodeDetailDockTab.tsx`) must also stop advertising the node's old title
once it goes missing, rather than leaving a stale title on the tab.

## Cross-surface travel: window events, not host callbacks

Node Detail renders in two hosts (a page route and a dock tab), so neither
host can own navigation callbacks — cross-surface travel is done with window
events, never host callbacks threaded down through the shared panel:

- `src/renderer/src/modules/workspace-nodes/internal/useNodeDetailBridges.ts`
  (`useNodeDetailBridges`) carries page↔canvas travel, including
  `FOCUS_NODE_ON_CANVAS_EVENT`;
- `dispatchOpenNode` (`src/renderer/src/utils/openNodeBridge.ts`) is used for
  relation rows.

`openNodeBridge.ts` also defines the sibling events `useNodeDetailBridges`
listens for: `OPEN_NODE_PAGE_EVENT` (`dispatchOpenNodePage`) to drill into a
node's own page, and `FOCUS_NODE_ON_CANVAS_EVENT`
(`dispatchFocusNodeOnCanvas`) to leave the knowledge surfaces and frame the
node on its canvas.

## Escape ownership

The page owns its own Escape handling —
`src/renderer/src/modules/workspace-nodes/internal/NodeDetailPage.tsx` adds a
`window` `keydown` listener in the bubble phase, gated on the event target
(ignored when the target is an `INPUT`/`TEXTAREA`/`contentEditable` element,
an open overlay, or an IME composition), and calls `onBack()`.

`src/renderer/src/hooks/useEscapeClose.ts` (`useEscapeClose`) is different by
design: it listens on `document` in the CAPTURE phase and calls
`stopPropagation()` — it backs the tag picker in
`src/renderer/src/modules/workspace-nodes/internal/NodeTagEditor.tsx`. Capture-phase
listeners run before any bubble-phase listener sees the event at all, so if
the page's own Escape subscriber were also capture-phase, it would win that
race and eat the Escape before it ever reached the tag picker's
`useEscapeClose` or `NodeTitleEditor.tsx`'s own inline Escape-to-cancel
`onKeyDown` handler. Keeping the page's handler bubble-phase and
target-gated is what lets a focused popover or in-progress title edit keep
first claim on Escape.

## `KnowledgeChatPortal` memoization rule

The detail route also hosts the global chat through
`src/renderer/src/components/shell/Workbench/KnowledgeChatPortal.tsx`. It must
memoize its selected node by the semantic `(workspaceId, nodeId)` pair —
concretely, `useMemo(() => buildKnowledgeChatContext(nodes, tags,
selectedNode), [nodes, selectedNodeId, selectedWorkspaceId, tags])`, keyed
off `selectedNode?.nodeId` / `selectedNode?.workspaceId` — never by the
`selectedNode` object's identity or the identity of the route object it came
from. If the memo dep were the route/selection object's identity instead of
the two primitive ids, a fresh object each render would recompute the chat
context every render; that recomputation is what causes the active-target
broker publish to trigger a parent rerender, which produces a new object
again, which unregisters and re-registers the chat target in a loop — surfacing
as React's "Maximum update depth exceeded".

## Evidence

Bound tests:

- `src/renderer/src/modules/workspace-nodes/internal/__tests__/NodeDetailPanel.test.tsx`
- `src/renderer/src/modules/workspace-nodes/internal/__tests__/NodeCanvasPreview.test.tsx`
  — save-failure + rich-presentation guards
- `src/renderer/src/modules/workspace-nodes/internal/__tests__/nodeDetailStyles.test.ts`
- `src/renderer/src/components/dock/RightDock/__tests__/dock-store.test.ts`
- `src/renderer/src/modules/workspace-nodes/internal/__tests__/NodeDetailPage.escape.test.tsx`
- `src/renderer/src/modules/workspace-nodes/internal/useWorkspaceNodes.test.tsx`
- `src/renderer/src/components/shell/Workbench/__tests__/ChatDockLifecycle.test.tsx`
  — includes the knowledge-detail chat-target-stability regression for the
  `KnowledgeChatPortal` memoization rule above
