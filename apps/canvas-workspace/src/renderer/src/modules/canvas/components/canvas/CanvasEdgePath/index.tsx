import type { MouseEvent } from 'react';
import type { CanvasEdge, EdgeStroke } from '../../../../../types';
import { resolveEdgePathGeometry } from '../../../model/edgeFactory';
import type { Point } from '../../../runtime/useEdgeInteraction';
import { capId, EdgeHandles, edgePaint, SELECTION_COLOR } from '../CanvasEdgesLayerParts';
import { isCanvasPanGesture } from '../CanvasNodeView/utils';

interface Props {
  edge: CanvasEdge;
  geometry: ReturnType<typeof resolveEdgePathGeometry>;
  selected: boolean;
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

const strokeDasharray = (style: EdgeStroke['style']): string | undefined => {
  if (style === 'dashed') return '6 4';
  if (style === 'dotted') return '1.5 3';
  return undefined;
};

export const CanvasEdgePath = ({
  edge,
  geometry,
  selected,
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

  return (
    <g>
      <path
        d={d}
        fill="none"
        stroke="transparent"
        strokeWidth={HIT_PROXY_WIDTH}
        vectorEffect="non-scaling-stroke"
        style={{ pointerEvents: 'stroke', cursor: 'grab' }}
        onMouseDown={(event) => {
          if (isCanvasPanGesture(event) || event.button !== 0) return;
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
          onMidpointDoubleClick={(event) => onBodyDoubleClick?.(edge.id, event)}
        />
      )}
      <path
        d={d}
        fill="none"
        stroke={stroke.color}
        style={{ stroke: edgePaint(stroke.color) }}
        strokeWidth={stroke.width}
        strokeDasharray={strokeDasharray(stroke.style)}
        strokeLinecap={head !== 'none' || tail !== 'none' ? 'butt' : 'round'}
        markerEnd={head !== 'none'
          ? `url(#${capId('edge-head', head, stroke.color, stroke.width)})`
          : undefined}
        markerStart={tail !== 'none'
          ? `url(#${capId('edge-tail', tail, stroke.color, stroke.width)})`
          : undefined}
      />
    </g>
  );
};
