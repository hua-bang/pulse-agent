# Frame Node Design

## 1. Summary
The Frame node is a Miro-style section/group: a lightweight, labeled region used to organize nodes spatially. It improves readability, provides structure for phases/areas, and lets users move clusters together without imposing layout or clipping.

## 2. Goals
- Make spatial grouping fast and low-friction (create, rename, resize, recolor).
- Support moving a cluster as a unit without losing individual node positions.
- Keep node layout free-form; frames do not clip or constrain content.
- Preserve grouping in persistence and in agent context summaries.

## 3. Non-Goals (MVP)
- Auto-layout of children or constraints-based layout.
- Collapsing or hiding children inside a frame.
- Cross-frame linking/graph edges.
- Collaborative frame ownership or permissions.
- Advanced nested layout systems (only basic nesting, if any, is supported).

## 4. Data Model
### 4.1 CanvasNode Extension
Add a new node type:
- type: "frame"

### 4.2 FrameNodeData
Recommended fields (all optional unless noted):
- title: string (uses CanvasNode.title)
- color: string (semantic token, e.g. "slate", "sand", "mint", "sunset")
- childIds: string[] (explicit membership)
- padding: number (default 24)
- headerHeight: number (default 28)

Notes:
- Frames are rendered behind other nodes by default; they do not clip children.
- childIds is authoritative. Geometry is used only to suggest membership changes on drop.

## 5. Visual Spec
- Header: small label chip at the top-left of the region.
- Body: translucent background with a subtle border and rounded corners.
- Color themes: 6-8 predefined palettes with low saturation to avoid overpowering nodes.
- Selected state: stronger border + glow; hover shows resize handles.

## 6. Interaction Model
### 6.1 Create
- Context menu on blank canvas: "New Frame" (creates a default frame at cursor).
- Selection to frame: "Frame Selection" creates a frame around selected nodes with padding.
- Toolbar entry (if present): Frame button.

### 6.2 Select
- Click header: select frame.
- Click body (empty area): select frame.
- Click node inside: select the node only.
- Shift-click allows multi-select with nodes and frames.

### 6.3 Drag
- Drag header: moves the frame and all child nodes by the same delta.
- Drag body: same as header (optional, but keeps behavior predictable).
- Dragging a node into a frame:
  - On drop, if the node center is inside frame bounds, add to childIds.
  - If dropped outside, remove from childIds (if it belonged).

### 6.4 Resize
- Resize handles at corners and edges.
- Default: resizing only changes the frame rect; children keep positions.
- Optional modifier (future): hold Shift to scale children with frame.

## 7. Membership Rules
- A node may belong to at most one frame (MVP).
- If two frames overlap and a node is dropped inside both, choose the smallest area frame or the last focused frame.
- Removing a frame does not delete child nodes; it only clears childIds.

## 8. Persistence
- Frame nodes are saved in canvas.json with other nodes.
- childIds should be validated on load; missing nodes are ignored.

## 9. Agent/Context Integration
- Canvas context summary should list frames and their child nodes.
- Frames can be used as high-level sections when exporting or summarizing work.

## 10. Edge Cases
- If a child node is removed, drop it from childIds.
