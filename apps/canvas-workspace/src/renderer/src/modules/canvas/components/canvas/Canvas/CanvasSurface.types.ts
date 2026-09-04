import type React from 'react';
import type { RefObject } from 'react';
import type {
  AgentContextDomReviewComment,
  AgentContextDomSelectionRef,
  CanvasEdge,
  CanvasNode,
} from '../../../../../types';
import type { SnapLine } from '../../../model/canvasSnapping';
import type { ChatDeliveryReceipt } from '../../../../chat';
import type { MindmapTransferHandlers } from '../../../mindmap/transfer';
import type { EdgeInteractionState, Point } from '../../../runtime/useEdgeInteraction';
import type { MarqueeRect } from '../../../runtime/useMarqueeSelect';
import type { NodeDragOffset, NodeDragPreview } from '../../../runtime/useNodeDrag';
import type { NodeResizePreview, ResizeEdge } from '../../../runtime/useNodeResize';
import type { ShapeDraft } from '../../../runtime/useShapeDraw';

interface NodeRenderGroup {
  containers: CanvasNode[];
  regular: CanvasNode[];
}

export interface CanvasSurfaceProps extends MindmapTransferHandlers {
  transform: { x: number; y: number; scale: number };
  transformLayerRef: RefObject<HTMLDivElement>;
  /** Scale as of the last moment the canvas was at rest (useCanvas).
   *  Drives `--canvas-scale` and the `--small` class INSTEAD of the live
   *  `transform.scale`: both restyle/repaint content inside the promoted
   *  compositor layer, and doing that per wheel tick invalidates the
   *  layer's tiles mid-gesture — the re-raster storm behind "tile memory
   *  limits exceeded" blank flashes. While a gesture is in flight the
   *  scale-compensated UI (terminal glyphs, frame headers) stretches with
   *  the canvas and snaps crisp once the gesture settles. */
  settledScale: number;
  animating: boolean;
  /** True while the user is actively panning/zooming. Drives conditional
   *  `will-change: transform` so the canvas subtree is only promoted to
   *  its own compositor layer while it's actually moving — avoiding the
   *  permanent tile-memory cost that otherwise trips Chromium's
   *  "tile memory limits exceeded" warning on canvases with many
   *  (especially nested) frames. */
  moving: boolean;
  renderGroups: NodeRenderGroup;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  rootFolder?: string;
  canvasId: string;
  canvasName?: string;
  draggingId: string | null;
  /** Every node participating in the current drag — includes descendants of a
   *  dragged frame so the full group can share the lifted stacking context. */
  draggingIds: Set<string>;
  dragPreview?: NodeDragPreview | null;
  /** Live delta for the current drag (B7) — every node in draggingIds/
   *  draggingId renders at `node.x/y + dragOffset` instead of the stored
   *  x/y, which stays frozen until the gesture commits. */
  dragOffset?: NodeDragOffset | null;
  resizingId: string | null;
  resizePreview?: NodeResizePreview | null;
  selectedNodeIdSet: Set<string>;
  selectedEdgeId: string | null;
  highlightedId: string | null;
  /** Node targeted by the Enter / F2 rename shortcut, with a bump token. */
  renameSignal?: { nodeId: string; token: number } | null;
  externallyEditedIds: Set<string>;
  /** Live edge interaction state — passed straight to the edges layer so it
   *  can render the preview / highlight the hover target. */
  edgeInteractionState: EdgeInteractionState | null;
  /** Preview endpoints resolved by the interaction hook. Null when no
   *  connect/move-end drag is in flight. */
  edgePreviewEndpoints: { s: Point; t: Point } | null;
  /** Live shape-draw draft. Null unless the user is currently dragging
   *  out a new shape. */
  shapeDraft?: ShapeDraft | null;
  /** Live marquee rectangle (canvas coordinates) while a box-select drag
   *  is in flight, null otherwise. Renders a dashed selection box. */
  marqueeRect?: MarqueeRect | null;
  /** Active alignment guides for the current drag, in canvas
   *  coordinates. Empty when nothing is snapping. */
  snapLines?: SnapLine[];
  focusedNodeIds?: Set<string>;
  focusContextNodeIds?: Set<string>;
  focusModeEnabled?: boolean;
  /** Non-interactive render for the read-only dock preview (default false). */
  readOnly?: boolean;
  onDragStart: (e: React.MouseEvent, node: CanvasNode) => void;
  onResizeStart: (e: React.MouseEvent, nodeId: string, width: number, height: number, edge: ResizeEdge, minWidth?: number, minHeight?: number) => void;
  onUpdate: (id: string, patch: Partial<CanvasNode>, options?: { history?: boolean }) => void;
  /** Dimension-only update that bypasses undo history. Used by nodes
   *  whose size is derived from their content (e.g. mindmap auto-fits
   *  to its topic tree) so every typed character doesn't spam the
   *  history stack with a paired text + resize entry. */
  onAutoResize: (id: string, width: number, height: number) => void;
  onRemove: (id: string) => void;
  onRemoveNodes?: (ids: string[]) => void;
  onExportMindmapImage: (id: string) => void;
  /** Selection callback that forwards optional shift/meta modifiers so
   *  the parent can honor multi-select intent. */
  onSelect: (id: string, mods?: { shift?: boolean; meta?: boolean }) => void;
  onFocus: (node: CanvasNode) => void;
  onReference?: (nodeId: string) => void;
  onAddToChat?: (nodeId: string) => void | Promise<ChatDeliveryReceipt>;
  onAddToCanvas?: (nodeId: string) => void;
  onAddDomSelectionToChat?: (selection: AgentContextDomSelectionRef) => Promise<ChatDeliveryReceipt>;
  onSubmitDomReviewComments?: (comments: AgentContextDomReviewComment[]) => Promise<boolean>;
  resolveReferenceNode?: (node: CanvasNode) => { node?: CanvasNode; workspaceName?: string };
  onOpenReferenceSource?: (node: CanvasNode) => void;
  onUpdateReferenceSource?: (referenceNode: CanvasNode, patch: Partial<CanvasNode>) => void;
  onUngroupSelectedGroups?: () => void;
  /** Node currently rendered fullscreen, if any. The matching
   *  CanvasNodeView stays in place inside `.canvas-transform` so its
   *  iframe / editor / terminal DOM never moves; CSS overrides on
   *  `.canvas-transform` and the node fill the viewport. */
  fullscreenNodeId?: string | null;
  onToggleFullscreen?: (nodeId: string) => void;
  onExitFullscreen?: () => void;
  onSelectEdge: (id: string | null) => void;
  onEdgeHandleMouseDown: (
    edgeId: string,
    handle: 'source' | 'target' | 'bend',
    e: React.MouseEvent,
    ctx: { s: Point; t: Point },
  ) => void;
  /** Mousedown on the edge body (not a handle). Starts a "translate
   *  the whole edge" drag. */
  onEdgeBodyMouseDown: (edgeId: string, e: React.MouseEvent) => void;
  /** Double-click on the edge body. Opens the edge-label editor. */
  onEdgeBodyDoubleClick: (edgeId: string, e: React.MouseEvent) => void;
  /** Right-click on the edge body. Opens the edge context menu. */
  onEdgeBodyContextMenu?: (edgeId: string, e: React.MouseEvent) => void;
  getAllNodes: () => CanvasNode[];
}
