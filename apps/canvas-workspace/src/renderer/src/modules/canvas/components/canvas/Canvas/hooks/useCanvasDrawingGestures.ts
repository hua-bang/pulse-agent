import { useCallback, type RefObject } from 'react';
import type { CanvasEdge, CanvasNode } from '../../../../../../types';
import type { useCanvasDocumentHost } from '../../../../document/useCanvasDocumentHost';
import { useConnectHandles } from '../../../../runtime/useConnectHandles';
import {
  useEdgeInteraction,
  type ConnectBlankDrop,
  type Point,
} from '../../../../runtime/useEdgeInteraction';
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
  /** Offers the create-node menu when a connect drag ends on blank canvas. */
  onConnectDropOnBlank?: (drop: ConnectBlankDrop) => void;
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
  onConnectDropOnBlank,
}: Options) {
  const getContainer = useCallback(() => containerRef.current, [containerRef]);
  const edgeInteraction = useEdgeInteraction({
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
    onConnectDropOnBlank: onConnectDropOnBlank
      ? (drop) => {
          // Leave connect mode now, as a committed edge does; the menu
          // then decides between a new connected node and the loose end.
          selection.setActiveTool('select');
          onConnectDropOnBlank(drop);
        }
      : undefined,
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
  const connectHandles = useConnectHandles({
    enabled: activeTool === 'select' && !edgeInteraction.state && !shape.isActive,
    sortedNodes,
    screenToCanvas,
    getContainer,
    beginConnect: edgeInteraction.beginConnect,
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
    edgePreview: edgeInteraction.previewEdge,
    edgeHandlers,
    connectHandles,
    shapeDraft: shape.draft,
    handleShapeOverlayMouseDown: shape.handleOverlayMouseDown,
    shapeToolActive: shape.isActive,
    marquee,
  };
}
