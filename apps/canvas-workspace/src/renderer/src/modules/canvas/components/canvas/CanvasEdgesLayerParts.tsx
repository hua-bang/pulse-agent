import type { CanvasNode, EdgeArrowCap } from '../../../../types';
import type { Point } from '../../runtime/useEdgeInteraction';
import { DEFAULT_EDGE_STROKE } from '../../../../../../shared/canvas';

export const SELECTION_COLOR = '#2a7fff';
export const HANDLE_RADIUS = 5;

/** The default edge color follows the theme; a picked color stays as is.
 *  Use it as a style value: SVG attributes do not resolve CSS variables. */
export const edgePaint = (color: string): string => (
  color === DEFAULT_EDGE_STROKE.color ? 'var(--edge-stroke)' : color
);

export const capId = (
  prefix: string,
  cap: EdgeArrowCap,
  color: string,
  width?: number,
): string => {
  const hex = color.replace(/[^a-zA-Z0-9]/g, '_');
  const size = width === undefined ? '' : `-${String(width).replace('.', '_')}`;
  return `${prefix}-${cap}-${hex}${size}`;
};

/**
 * Edge cap size in canvas px. Caps grow slower than the stroke, so thin
 * edges keep a readable arrow and thick edges do not get oversized ones.
 */
export const capSize = (strokeWidth: number): number => 6 + strokeWidth * 2.5;

const MarkerShape = ({ cap, color }: { cap: EdgeArrowCap; color: string }) => {
  switch (cap) {
    case 'triangle':
      return <path d="M0,1.5 L10,5 L0,8.5 z" fill={color} style={{ fill: edgePaint(color) }} />;
    case 'arrow':
      return (
        <path
          d="M0,1.5 L10,5 L0,8.5"
          fill="none"
          stroke={color}
          style={{ stroke: edgePaint(color) }}
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    case 'dot':
      return <circle cx={5} cy={5} r={3.2} fill={color} style={{ fill: edgePaint(color) }} />;
    case 'bar':
      return <rect x={4} y={0} width={2} height={10} fill={color} style={{ fill: edgePaint(color) }} />;
    case 'none':
    default:
      return null;
  }
};

export const Markers = ({
  markers,
}: {
  markers: Array<{
    id: string;
    cap: EdgeArrowCap;
    color: string;
    width: number;
    side: 'head' | 'tail';
  }>;
}) => (
  <defs>
    {markers.map(({ id, cap, color, width, side }) => (
      <marker
        key={id}
        id={id}
        markerWidth={capSize(width)}
        markerHeight={capSize(width)}
        viewBox="0 0 10 10"
        orient={side === 'head' ? 'auto' : 'auto-start-reverse'}
        refX={cap === 'triangle' || cap === 'arrow' ? 10 : 5}
        refY={5}
        markerUnits="userSpaceOnUse"
      >
        <MarkerShape cap={cap} color={color} />
      </marker>
    ))}
  </defs>
);

export const EdgeHandles = ({
  s,
  t,
  midpoint,
  onHandleMouseDown,
  onMidpointDoubleClick,
}: {
  s: Point;
  t: Point;
  midpoint: Point;
  onHandleMouseDown: (handle: 'source' | 'target' | 'bend', e: React.MouseEvent) => void;
  /** The bend handle covers the edge's midpoint, where users double-click
   *  to edit the label, so it forwards that gesture. */
  onMidpointDoubleClick?: (e: React.MouseEvent) => void;
}) => {
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
        cx={midpoint.x}
        cy={midpoint.y}
        r={HANDLE_RADIUS - 0.5}
        fill="#ffffff"
        stroke={SELECTION_COLOR}
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
        style={handleStyle}
        onMouseDown={(e) => {
          e.stopPropagation();
          // The bend drag puts a shield over the canvas, so the second
          // click never reaches this circle as a dblclick. Read the click
          // count on mousedown instead, and keep the mousedown from moving
          // focus off the label input it opens.
          if (e.detail >= 2 && onMidpointDoubleClick) {
            e.preventDefault();
            onMidpointDoubleClick(e);
            return;
          }
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
  d,
  width,
  highlightNode,
}: {
  /** Same path the committed edge will use; null hides the draft line. */
  d: string | null;
  /** Committed stroke width, so the draft line and cap match the result. */
  width: number;
  highlightNode: CanvasNode | null;
}) => (
  <>
    {d && (
      <path
        d={d}
        fill="none"
        stroke={SELECTION_COLOR}
        strokeWidth={width}
        strokeDasharray="6 4"
        strokeLinecap="butt"
        markerEnd={`url(#${capId('edge-head', 'triangle', SELECTION_COLOR)})`}
        style={{ pointerEvents: 'none' }}
      />
    )}
    <defs>
      <marker
        id={capId('edge-head', 'triangle', SELECTION_COLOR)}
        markerWidth={capSize(width)}
        markerHeight={capSize(width)}
        viewBox="0 0 10 10"
        orient="auto"
        refX={10}
        refY={5}
        markerUnits="userSpaceOnUse"
      >
        <path d="M0,1.5 L10,5 L0,8.5 z" fill={SELECTION_COLOR} />
      </marker>
    </defs>
    {highlightNode && (
      <rect
        x={highlightNode.x - 2}
        y={highlightNode.y - 2}
        width={highlightNode.width + 4}
        height={highlightNode.height + 4}
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
