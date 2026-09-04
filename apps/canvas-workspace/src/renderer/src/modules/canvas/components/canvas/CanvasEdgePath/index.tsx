import type { CSSProperties, MouseEvent } from 'react';
import type { CanvasEdge, EdgeStroke } from '../../../../../types';
import { resolveEdgePathGeometry } from '../../../../../utils/edgeFactory';
import type { Point } from '../../../runtime/useEdgeInteraction';
import { capId, EdgeHandles, SELECTION_COLOR } from '../CanvasEdgesLayerParts';

interface Props {
  edge: CanvasEdge;
  geometry: ReturnType<typeof resolveEdgePathGeometry>;
  selected: boolean;
  focusedNodeIds?: Set<string>;
  focusContextNodeIds?: Set<string>;
  focusModeEnabled: boolean;
  onSelectEdge?: (id: string | null) => void;
  onHandleMouseDown?: (
    edgeId: string,
    handle: 'source' | 'target' | 'bend',
    event: MouseEvent,
    context: { s: Point; t: Point },
  ) => void;
  onBodyMouseDown?: (edgeId: string, event: MouseEvent) => void;
  onBodyDoubleClick?: (edgeId: string, event: MouseEvent) => void;
  onBodyContextMenu?: (edgeId: string, event: MouseEvent) => void;
  stroke: { color: string; width: number; style: EdgeStroke['style'] };
}

const HIT_PROXY_WIDTH = 16;
const FOCUS_DIMMED_EDGE_OPACITY = 0.12;
const FOCUS_CONTEXT_EDGE_OPACITY = 0.45;

const strokeDasharray = (style: EdgeStroke['style']): string | undefined => {
  if (style === 'dashed') return '6 4';
  if (style === 'dotted') return '1.5 3';
  return undefined;
};

export const CanvasEdgePath = ({
  edge,
  geometry,
  selected,
  focusedNodeIds,
  focusContextNodeIds,
  focusModeEnabled,
  onSelectEdge,
  onHandleMouseDown,
  onBodyMouseDown,
  onBodyDoubleClick,
  onBodyContextMenu,
  stroke,
}: Props) => {
  const { sourcePoint: source, targetPoint: target, d, midpoint } = geometry;
  const head = edge.arrowHead ?? 'triangle';
  const tail = edge.arrowTail ?? 'none';
  const sourceFocused = edge.source.kind === 'node'
    && focusedNodeIds?.has(edge.source.nodeId);
  const targetFocused = edge.target.kind === 'node'
    && focusedNodeIds?.has(edge.target.nodeId);
  const sourceInContext = edge.source.kind === 'node'
    && focusContextNodeIds?.has(edge.source.nodeId);
  const targetInContext = edge.target.kind === 'node'
    && focusContextNodeIds?.has(edge.target.nodeId);
  const focused = !focusModeEnabled || selected || sourceFocused || targetFocused;
  const inContext = !focused && sourceInContext && targetInContext;
  const focusStyle: CSSProperties | undefined = focusModeEnabled && !focused
    ? { opacity: inContext ? FOCUS_CONTEXT_EDGE_OPACITY : FOCUS_DIMMED_EDGE_OPACITY }
    : undefined;

  return (
    <g style={focusStyle}>
      <path
        d={d}
        fill="none"
        stroke="transparent"
        strokeWidth={HIT_PROXY_WIDTH}
        vectorEffect="non-scaling-stroke"
        style={{ pointerEvents: 'stroke', cursor: 'grab' }}
        onMouseDown={(event) => {
          event.stopPropagation();
          onSelectEdge?.(edge.id);
          onBodyMouseDown?.(edge.id, event);
        }}
        onDoubleClick={(event) => {
          event.stopPropagation();
          onBodyDoubleClick?.(edge.id, event);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onBodyContextMenu?.(edge.id, event);
        }}
      />
      {selected && (
        <path
          d={d}
          fill="none"
          stroke={SELECTION_COLOR}
          strokeOpacity={0.35}
          strokeWidth={stroke.width + 6}
          strokeLinecap="round"
        />
      )}
      {selected && onHandleMouseDown && (
        <EdgeHandles
          s={source}
          t={target}
          midpoint={midpoint}
          onHandleMouseDown={(handle, event) => (
            onHandleMouseDown(edge.id, handle, event, { s: source, t: target })
          )}
        />
      )}
      <path
        d={d}
        fill="none"
        stroke={stroke.color}
        strokeWidth={stroke.width}
        strokeDasharray={strokeDasharray(stroke.style)}
        strokeLinecap={head !== 'none' || tail !== 'none' ? 'butt' : 'round'}
        markerEnd={head !== 'none'
          ? `url(#${capId('edge-head', head, stroke.color)})`
          : undefined}
        markerStart={tail !== 'none'
          ? `url(#${capId('edge-tail', tail, stroke.color)})`
          : undefined}
      />
    </g>
  );
};
