import type { CanvasEdge, CanvasNode, EdgeArrowCap } from '../types';
import { bendHandlePoint } from '../utils/edgeFactory';
import type { Point } from '../hooks/useEdgeInteraction';

export const SELECTION_COLOR = '#2a7fff';
export const HANDLE_RADIUS = 5;

export const capId = (prefix: string, cap: EdgeArrowCap, color: string): string => {
  const hex = color.replace(/[^a-zA-Z0-9]/g, '_');
  return `${prefix}-${cap}-${hex}`;
};

const MarkerShape = ({ cap, color }: { cap: EdgeArrowCap; color: string }) => {
  switch (cap) {
    case 'triangle':
      return <path d="M0,1.5 L10,5 L0,8.5 z" fill={color} />;
    case 'arrow':
      return (
        <path
          d="M0,1.5 L10,5 L0,8.5"
          fill="none"
          stroke={color}
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    case 'dot':
      return <circle cx={5} cy={5} r={3.2} fill={color} />;
    case 'bar':
      return <rect x={4} y={0} width={2} height={10} fill={color} />;
    case 'none':
    default:
      return null;
  }
};

export const Markers = ({
  markers,
}: {
  markers: Array<{ id: string; cap: EdgeArrowCap; color: string; side: 'head' | 'tail' }>;
}) => (
  <defs>
    {markers.map(({ id, cap, color, side }) => (
      <marker
        key={id}
        id={id}
        markerWidth={4}
        markerHeight={4}
        viewBox="0 0 10 10"
        orient={side === 'head' ? 'auto' : 'auto-start-reverse'}
        refX={cap === 'triangle' || cap === 'arrow' ? 10 : 5}
        refY={5}
        markerUnits="strokeWidth"
      >
        <MarkerShape cap={cap} color={color} />
      </marker>
    ))}
  </defs>
);

export const EdgeHandles = ({
  edge,
  s,
  t,
  onHandleMouseDown,
}: {
  edge: CanvasEdge;
  s: Point;
  t: Point;
  onHandleMouseDown: (handle: 'source' | 'target' | 'bend', e: React.MouseEvent) => void;
}) => {
  const bend = edge.bend ?? 0;
  const mid = bendHandlePoint(s, t, bend);
  const handleStyle: React.CSSProperties = {
    pointerEvents: 'all',
    cursor: 'grab',
  };

  return (
    <>
      <circle
        cx={s.x}
        cy={s.y}
        r={HANDLE_RADIUS}
        fill="#ffffff"
        stroke={SELECTION_COLOR}
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
        style={handleStyle}
        onMouseDown={(e) => {
          e.stopPropagation();
          onHandleMouseDown('source', e);
        }}
      />
      <circle
        cx={mid.x}
        cy={mid.y}
        r={HANDLE_RADIUS - 0.5}
        fill="#ffffff"
        stroke={SELECTION_COLOR}
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
        style={handleStyle}
        onMouseDown={(e) => {
          e.stopPropagation();
          onHandleMouseDown('bend', e);
        }}
      />
      <circle
        cx={t.x}
        cy={t.y}
        r={HANDLE_RADIUS}
        fill="#ffffff"
        stroke={SELECTION_COLOR}
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
        style={handleStyle}
        onMouseDown={(e) => {
          e.stopPropagation();
          onHandleMouseDown('target', e);
        }}
      />
    </>
  );
};

export const PreviewEdge = ({
  s,
  t,
  highlightNodeId,
  nodesById,
}: {
  s: Point;
  t: Point;
  highlightNodeId: string | null;
  nodesById: Map<string, CanvasNode>;
}) => {
  const d = `M ${s.x} ${s.y} L ${t.x} ${t.y}`;
  const node = highlightNodeId ? nodesById.get(highlightNodeId) : null;
  return (
    <>
      <path
        d={d}
        fill="none"
        stroke={SELECTION_COLOR}
        strokeWidth={1.5}
        strokeDasharray="5 3"
        strokeLinecap="butt"
        markerEnd={`url(#${capId('edge-head', 'triangle', SELECTION_COLOR)})`}
        style={{ pointerEvents: 'none' }}
      />
      <defs>
        <marker
          id={capId('edge-head', 'triangle', SELECTION_COLOR)}
          markerWidth={4}
          markerHeight={4}
          viewBox="0 0 10 10"
          orient="auto"
          refX={10}
          refY={5}
          markerUnits="strokeWidth"
        >
          <path d="M0,1.5 L10,5 L0,8.5 z" fill={SELECTION_COLOR} />
        </marker>
      </defs>
      {node && (
        <rect
          x={node.x - 2}
          y={node.y - 2}
          width={node.width + 4}
          height={node.height + 4}
          fill="none"
          stroke={SELECTION_COLOR}
          strokeWidth={1.5}
          strokeDasharray="4 3"
          vectorEffect="non-scaling-stroke"
          style={{ pointerEvents: 'none' }}
          rx={6}
        />
      )}
    </>
  );
};
