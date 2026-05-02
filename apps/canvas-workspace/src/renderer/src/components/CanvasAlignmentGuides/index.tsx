import type { SnapLine } from '../../utils/canvasSnapping';

interface Props {
  lines: SnapLine[];
  /** Active scale — used to keep stroke width constant in screen pixels
   *  even when the parent `.canvas-transform` is zoomed. */
  scale: number;
}

const STROKE_PX = 1;
const COLOR = '#FF3B7B';

/**
 * Pink alignment guides drawn while a drag is snapping. Rendered inside
 * `.canvas-transform` so the guide coordinates are canvas-native and
 * the lines stay glued to the matched node edges as the user pans /
 * zooms during the drag.
 *
 * The lines are pointer-events-none — the user keeps interacting with
 * the canvas underneath (the drag handler still owns the mouse).
 */
export const CanvasAlignmentGuides = ({ lines, scale }: Props) => {
  if (lines.length === 0) return null;
  // Counter-scale the stroke so it always reads as STROKE_PX on screen.
  const strokeWidth = STROKE_PX / Math.max(scale, 0.0001);

  return (
    <svg
      className="canvas-alignment-guides"
      style={{
        position: 'absolute',
        // Anchor at the canvas origin and let SVG draw negative
        // coordinates — the guide may extend "before" the origin.
        left: 0,
        top: 0,
        width: 1,
        height: 1,
        overflow: 'visible',
        pointerEvents: 'none',
      }}
    >
      {lines.map((line, i) => {
        if (line.axis === 'x') {
          return (
            <line
              key={`x-${i}-${line.position}`}
              x1={line.position}
              x2={line.position}
              y1={line.start}
              y2={line.end}
              stroke={COLOR}
              strokeWidth={strokeWidth}
              shapeRendering="crispEdges"
            />
          );
        }
        return (
          <line
            key={`y-${i}-${line.position}`}
            x1={line.start}
            x2={line.end}
            y1={line.position}
            y2={line.position}
            stroke={COLOR}
            strokeWidth={strokeWidth}
            shapeRendering="crispEdges"
          />
        );
      })}
    </svg>
  );
};
