import type { RefObject } from 'react';
import type { CanvasEdge, CanvasNode } from '../../../../../types';
import type { MergeMindmapTopicRequest } from '../../../mindmap/transfer';
import type { EdgeInteractionState, Point } from '../../../runtime/useEdgeInteraction';
import type { ShapeDraft } from '../../../runtime/useShapeDraw';
import type { useCanvasContextMenu } from './hooks/useCanvasContextMenu';
import type { useCanvasEdgeHandlers } from './hooks/useCanvasEdgeHandlers';
import type { useCanvasFocusMode } from './hooks/useCanvasFocusMode';
import type { useCanvasMouseHandlers } from './hooks/useCanvasMouseHandlers';
import type { useCanvasNodeActions } from './hooks/useCanvasNodeActions';
import type { useCanvasNodeGestures } from './hooks/useCanvasNodeGestures';
import type { useCanvasPaletteCommands } from './hooks/useCanvasPaletteCommands';
import type { useCanvasSearch } from '../../../runtime/useCanvasSearch';
import type { useMarqueeSelect } from '../../../runtime/useMarqueeSelect';
import type { CanvasProps } from './types';

export type CanvasRootViewProps = Pick<
  CanvasProps,
  | 'canvasId'
  | 'canvasName'
  | 'rootFolder'
  | 'chatPanelOpen'
  | 'onChatToggle'
  | 'onChatOpen'
  | 'referenceDrawerOpen'
  | 'onReferenceToggle'
  | 'onPinReferenceNode'
  | 'onAddToChat'
  | 'onAddDomSelectionToChat'
  | 'onSubmitDomReviewComments'
  | 'resolveReferenceNode'
  | 'onOpenReferenceSource'
  | 'onUpdateReferenceSource'
  | 'onSetRootFolder'
> & {
  actions: ReturnType<typeof useCanvasNodeActions>;
  activeTool: string;
  animating: boolean;
  containerRef: RefObject<HTMLDivElement>;
  ctxMenu: ReturnType<typeof useCanvasContextMenu>;
  nodeGestures: ReturnType<typeof useCanvasNodeGestures>;
  edgeHandlers: ReturnType<typeof useCanvasEdgeHandlers>;
  edgeInteractionState: EdgeInteractionState | null;
  edges: CanvasEdge[];
  editingEdgeLabelId: string | null;
  externallyEditedIds: Set<string>;
  findNodesById: Map<string, CanvasNode>;
  focus: ReturnType<typeof useCanvasFocusMode>;
  getAllNodes: () => CanvasNode[];
  getPreviewEndpoints: () => { s: Point; t: Point } | null;
  handleNodeViewportFocus: (node: CanvasNode) => void;
  handleCreateAgentTeam?: () => void;
  handleCreateDemoCanvas?: () => void;
  handleSearchMatchActivate: (node: CanvasNode) => void;
  handleSelectNode: (id: string, mods?: { shift?: boolean; meta?: boolean }) => void;
  handleShapeOverlayMouseDown: (event: React.MouseEvent) => void;
  handleWheel: (event: React.WheelEvent) => void;
  highlightedId: string | null;
  renameSignal?: { nodeId: string; token: number } | null;
  loaded: boolean;
  marquee: ReturnType<typeof useMarqueeSelect>;
  mouse: ReturnType<typeof useCanvasMouseHandlers>;
  moving: boolean;
  nodes: CanvasNode[];
  nodesById: Map<string, CanvasNode>;
  onFitAll?: () => void;
  openShortcuts: () => void;
  paletteCommands: ReturnType<typeof useCanvasPaletteCommands>;
  resetTransform: () => void;
  resizeNode: (id: string, width: number, height: number) => void;
  settledScale: number;
  search: ReturnType<typeof useCanvasSearch>;
  searchOpen: boolean;
  selectedEdgeId: string | null;
  selectedNodeIdSet: Set<string>;
  selectedNodeIds: string[];
  setActiveTool: (tool: string) => void;
  setSearchOpen: (open: boolean) => void;
  setSelectedEdgeId: (id: string | null) => void;
  setSelectedNodeIds: (ids: string[]) => void;
  shapeDraft: ShapeDraft | null;
  shapeToolActive: boolean;
  transform: { x: number; y: number; scale: number };
  transformLayerRef: RefObject<HTMLDivElement>;
  updateEdge: (id: string, patch: Partial<CanvasEdge>) => void;
  updateNode: (id: string, patch: Partial<CanvasNode>) => void;
  onRemoveNodesLocally: (ids: string[]) => void;
  onMergeMindmapTopic: (request: MergeMindmapTopicRequest) => boolean;
  onSplitMindmapTopic: (
    sourceNodeId: string,
    sourceTopicId: string,
    clientX: number,
    clientY: number,
  ) => boolean;
};
