import { useCallback, type RefObject } from 'react';
import type { CanvasEdge, CanvasNode } from '../../../../../../types';
import type { useCanvasDocumentHost } from '../../../../document/useCanvasDocumentHost';
import { useEdgeInteraction, type Point } from '../../../../runtime/useEdgeInteraction';
import { useMarqueeSelect } from '../../../../runtime/useMarqueeSelect';
import { useShapeDraw } from '../../../../runtime/useShapeDraw';
import { useCanvasEdgeHandlers } from './useCanvasEdgeHandlers';

type DocumentCommands = Pick<
  ReturnType<typeof useCanvasDocumentHost>,
  'addEdge' | 'updateEdge' | 'commitHistory' | 'addNode' | 'updateNode'
>;

interface SelectionCommands {
  setActiveTool: (tool: string) => void;
  setSelectedEdgeId: (id: string | null) => void;
  setSelectedNodeIds: (ids: string[]) => void;
  setEditingEdgeLabelId: (id: string | null) => void;
  handleMarqueeSelect: (
    ids: string[],
    modifiers: { shift: boolean; meta: boolean },
  ) => void;
}

interface Options {
  activeTool: string;
  containerRef: RefObject<HTMLDivElement>;
  document: DocumentCommands;
  edges: CanvasEdge[];
  nodes: CanvasNode[];
  sortedNodes: CanvasNode[];
  screenToCanvas: (
    screenX: number,
    screenY: number,
    container: HTMLElement,
  ) => Point;
  selection: SelectionCommands;
}

export function useCanvasDrawingGestures({
  activeTool,
  containerRef,
  document,
  edges,
  nodes,
  sortedNodes,
  screenToCanvas,
  selection,
}: Options) {
  const getContainer = useCallback(() => containerRef.current, [containerRef]);
  const edgeInteraction = useEdgeInteraction({
    nodes,
    sortedNodes,
    screenToCanvas,
    getContainer,
    addEdge: document.addEdge,
    updateEdge: document.updateEdge,
    commitHistory: document.commitHistory,
    edges,
    onConnectCommitted: (edgeId) => {
      selection.setActiveTool('select');
      selection.setSelectedEdgeId(edgeId);
      selection.setSelectedNodeIds([]);
    },
  });
  const edgeHandlers = useCanvasEdgeHandlers({
    beginConnect: edgeInteraction.beginConnect,
    beginMoveEnd: edgeInteraction.beginMoveEnd,
    beginMoveBend: edgeInteraction.beginMoveBend,
    beginMoveEdge: edgeInteraction.beginMoveEdge,
    updateEdge: document.updateEdge,
    setSelectedEdgeId: selection.setSelectedEdgeId,
    setSelectedNodeIds: selection.setSelectedNodeIds,
    setEditingEdgeLabelId: selection.setEditingEdgeLabelId,
  });
  const shape = useShapeDraw({
    activeTool,
    screenToCanvas,
    getContainer,
    addNode: document.addNode,
    updateNode: document.updateNode,
    onCommitted: (node) => {
      selection.setActiveTool('select');
      selection.setSelectedNodeIds([node.id]);
      selection.setSelectedEdgeId(null);
    },
  });
  const marquee = useMarqueeSelect({
    enabled: activeTool === 'select' && !shape.isActive,
    screenToCanvas,
    getContainer,
    nodes,
    onSelect: selection.handleMarqueeSelect,
  });

  return {
    edgeInteractionState: edgeInteraction.state,
    getPreviewEndpoints: edgeInteraction.getPreviewEndpoints,
    edgeHandlers,
    shapeDraft: shape.draft,
    handleShapeOverlayMouseDown: shape.handleOverlayMouseDown,
    shapeToolActive: shape.isActive,
    marquee,
  };
}
