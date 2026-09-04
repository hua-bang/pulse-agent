import type React from 'react';
import type { CanvasEdge, CanvasNode, CanvasTransform } from '../../../../../types';
import type { CreatableCanvasNodeType } from '../../../../../utils/nodeFactory';
import type { AddNodeOptions } from '../../..';
import type { PaletteCommand } from '../CommandPalette';
import type { EdgeInteractionState } from '../../../runtime/useEdgeInteraction';
import type { UseCanvasSearchReturn } from '../../../runtime/useCanvasSearch';

interface AddNodeUiOptions extends AddNodeOptions {
  label?: string;
}

export interface CanvasOverlaysProps {
  nodes: CanvasNode[];
  contextMenu: {
    screenX: number;
    screenY: number;
    canvasX: number;
    canvasY: number;
  } | null;
  searchOpen: boolean;
  activeTool: string;
  /** True while pan/zoom is in flight. Transform-sensitive overlays are
   *  parked so the gesture path does not recompute screen-space DOM. */
  moving?: boolean;
  scale: number;
  /** Reframe the viewport around every node. Surfaced next to the zoom chip. */
  onFitAll?: () => void;
  chatPanelOpen?: boolean;
  onChatToggle?: () => void;
  referenceDrawerOpen?: boolean;
  onReferenceToggle?: () => void;
  onCreateNode: (type: CreatableCanvasNodeType) => void;
  onCreateDemo?: () => void;
  onCreateAgentTeam?: () => void;
  onCloseContextMenu: () => void;
  onOpenShortcuts: () => void;
  onSetRootFolder?: () => void;
  onToolChange: (tool: string) => void;
  onAddNode: (type: CreatableCanvasNodeType, options?: AddNodeUiOptions) => void;
  onResetTransform: () => void;
  /** Commands shown in the Cmd+K palette alongside node search results.
   *  Built by the parent so each entry can capture the latest tool /
   *  selection / chat state when fired. */
  paletteCommands: PaletteCommand[];
  onSearchSelect: (node: CanvasNode) => void;
  onCloseSearch: () => void;
  /** Find-in-canvas (Ctrl/Cmd+F) state, owned by the parent so the
   *  keyboard hook and the bar share one source of truth. */
  findSearch: UseCanvasSearchReturn;
  findNodesById: Map<string, CanvasNode>;
  onFindMatchActivate: (node: CanvasNode) => void;
  /** Mousedown handler for the connect-mode overlay. Wired by the
   *  parent Canvas component to the edge interaction hook. */
  onConnectMouseDown?: (e: React.MouseEvent) => void;
  /** True whenever the user has picked one of the shape-draw tools
   *  (shape-rect / shape-ellipse). Drives the draw overlay. */
  shapeToolActive?: boolean;
  /** Mousedown handler for the shape-draw overlay. */
  onShapeMouseDown?: (e: React.MouseEvent) => void;
  /** Currently-selected edge (full object) — null when none or the
   *  selection refers to a node. The overlays layer uses it to render
   *  the floating EdgeStylePanel. */
  selectedEdge?: CanvasEdge | null;
  /** Render-only drag geometry shared by the solid edge, label, and panel. */
  edgeInteractionState?: EdgeInteractionState | null;
  /** Canvas transform, needed by EdgeStylePanel to project the edge
   *  midpoint from canvas space to screen space. */
  transform: CanvasTransform;
  onUpdateEdge?: (id: string, patch: Partial<CanvasEdge>) => void;
  onRemoveEdge?: (id: string) => void;
  /** All edges — needed for label rendering. Labels render as DOM
   *  overlay elements (outside .canvas-transform) so text stays crisp
   *  and editable regardless of zoom. */
  edges?: CanvasEdge[];
  /** Id of the edge whose label is currently in edit mode, or null. */
  editingEdgeLabelId?: string | null;
  onStartEditEdgeLabel?: (id: string) => void;
  onCommitEditEdgeLabel?: (id: string, label: string) => void;
  onCancelEditEdgeLabel?: () => void;
}

