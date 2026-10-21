import { memo, useMemo } from 'react';
import { resolveEdgeStroke } from '../../../../../../shared/canvas';
import type { CanvasEdge, CanvasNode, EdgeArrowCap } from '../../../../types';
import { resolveEdgePathGeometry } from '../../model/edgeFactory';
import type { EdgeInteractionState, Point } from '../../runtime/useEdgeInteraction';
import { CanvasEdgePath } from './CanvasEdgePath';
import {
  capId,
  Markers,
  PreviewEdge,
} from './CanvasEdgesLayerParts';

export interface CanvasEdgesLayerProps {
  edges: CanvasEdge[];
  nodes: CanvasNode[];
  selectedEdgeId: string | null;
  onSelectEdge?: (id: string | null) => void;
  interactionState?: EdgeInteractionState | null;
  /** Draft edge for the connect gesture; rendered with committed geometry. */
  previewEdge?: CanvasEdge | null;
  focusedNodeIds?: Set<string>;
  focusContextNodeIds?: Set<string>;
  focusModeEnabled?: boolean;
  onHandleMouseDown?: (
    edgeId: string,
    handle: 'source' | 'target' | 'bend',
    event: React.MouseEvent,
    context: { s: Point; t: Point },
  ) => void;
  onBodyMouseDown?: (edgeId: string, event: React.MouseEvent) => void;
  onBodyDoubleClick?: (edgeId: string, event: React.MouseEvent) => void;
  onBodyContextMenu?: (edgeId: string, event: React.MouseEvent) => void;
}

/** Apply render-only drag geometry without mutating the canonical edge. */
export const applyEdgeInteractionPreview = (
  edge: CanvasEdge,
  interactionState: EdgeInteractionState | null | undefined,
): CanvasEdge => {
  if (
    !interactionState
    || interactionState.kind === 'connect'
    || interactionState.edgeId !== edge.id
  ) {
    return edge;
  }
  const patch = interactionState.previewPatch;
  if (patch.source === undefined && patch.target === undefined && patch.bend === undefined) {
    return edge;
  }
  return { ...edge, ...patch };
};

const useMarkerDefs = (edges: CanvasEdge[]) => useMemo(() => {
  const markers = new Map<
    string,
    { id: string; cap: EdgeArrowCap; color: string; width: number; side: 'head' | 'tail' }
  >();
  for (const edge of edges) {
    const { color, width } = resolveEdgeStroke(edge.stroke);
    const head = edge.arrowHead ?? 'triangle';
    const tail = edge.arrowTail ?? 'none';
    if (head !== 'none') {
      const id = capId('edge-head', head, color, width);
      if (!markers.has(id)) markers.set(id, { id, cap: head, color, width, side: 'head' });
    }
    if (tail !== 'none') {
      const id = capId('edge-tail', tail, color, width);
      if (!markers.has(id)) markers.set(id, { id, cap: tail, color, width, side: 'tail' });
    }
  }
  return Array.from(markers.values());
}, [edges]);

const CanvasEdgesLayerComponent = ({
  edges,
  nodes,
  selectedEdgeId,
  onSelectEdge,
  interactionState,
  previewEdge,
  focusedNodeIds,
  focusContextNodeIds,
  focusModeEnabled = false,
  onHandleMouseDown,
  onBodyMouseDown,
  onBodyDoubleClick,
  onBodyContextMenu,
}: CanvasEdgesLayerProps) => {
  const nodesById = useMemo(
    () => new Map(nodes.map((node) => [node.id, node])),
    [nodes],
  );
  const markers = useMarkerDefs(edges);
  const resolved = useMemo(() => edges.map((edge) => {
    const renderedEdge = applyEdgeInteractionPreview(edge, interactionState);
    return {
      edge: renderedEdge,
      geometry: resolveEdgePathGeometry(renderedEdge, nodesById),
    };
  }), [edges, interactionState, nodesById]);
  const previewGeometry = useMemo(
    () => (previewEdge ? resolveEdgePathGeometry(previewEdge, nodesById) : null),
    [previewEdge, nodesById],
  );
  const hoverNode = interactionState?.kind === 'connect' || interactionState?.kind === 'move-end'
    ? nodesById.get(interactionState.hoverNodeId ?? '') ?? null
    : null;
  const sourceNodeId = interactionState?.kind === 'connect' && interactionState.source.kind === 'node'
    ? interactionState.source.nodeId
    : null;
  const highlightNode = hoverNode && hoverNode.id !== sourceNodeId ? hoverNode : null;

  if (edges.length === 0 && !previewGeometry && !highlightNode) return null;

  return (
    <svg
      className="canvas-edges"
      width={1}
      height={1}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        overflow: 'visible',
        pointerEvents: 'none',
      }}
    >
      <Markers markers={markers} />
      {resolved.map(({ edge, geometry }) => (
        <CanvasEdgePath
          key={edge.id}
          edge={edge}
          geometry={geometry}
          selected={edge.id === selectedEdgeId}
          focusedNodeIds={focusedNodeIds}
          focusContextNodeIds={focusContextNodeIds}
          focusModeEnabled={focusModeEnabled}
          onSelectEdge={onSelectEdge}
          onHandleMouseDown={onHandleMouseDown}
          onBodyMouseDown={onBodyMouseDown}
          onBodyDoubleClick={onBodyDoubleClick}
          onBodyContextMenu={onBodyContextMenu}
          stroke={resolveEdgeStroke(edge.stroke)}
        />
      ))}
      {(previewGeometry || highlightNode) && (
        <PreviewEdge
          d={previewGeometry?.d ?? null}
          width={resolveEdgeStroke(previewEdge?.stroke).width}
          highlightNode={highlightNode}
        />
      )}
    </svg>
  );
};

// Handler props intentionally stay outside this comparator: callers pass
// fresh closures over stable hook commands, while edge data identity is the
// measured hot path during pan/zoom.
export const canvasEdgesLayerPropsAreEqual = (
  previous: CanvasEdgesLayerProps,
  next: CanvasEdgesLayerProps,
): boolean => (
  previous.edges === next.edges
  && previous.nodes === next.nodes
  && previous.selectedEdgeId === next.selectedEdgeId
  && previous.interactionState === next.interactionState
  && previous.previewEdge === next.previewEdge
  && previous.focusedNodeIds === next.focusedNodeIds
  && previous.focusContextNodeIds === next.focusContextNodeIds
  && previous.focusModeEnabled === next.focusModeEnabled
);

export const CanvasEdgesLayer = memo(
  CanvasEdgesLayerComponent,
  canvasEdgesLayerPropsAreEqual,
);
