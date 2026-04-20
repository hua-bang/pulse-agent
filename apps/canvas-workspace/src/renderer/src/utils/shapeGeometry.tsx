import type { ShapeNodeData } from '../types';

export type ShapeKind = ShapeNodeData['kind'];

export const SHAPE_KINDS: ShapeKind[] = [
  'rect',
  'rounded-rect',
  'ellipse',
  'triangle',
  'diamond',
  'hexagon',
  'star',
];

export const SHAPE_KIND_LABEL: Record<ShapeKind, string> = {
  'rect': 'Rectangle',
  'rounded-rect': 'Rounded rectangle',
  'ellipse': 'Ellipse',
  'triangle': 'Triangle',
  'diamond': 'Diamond',
  'hexagon': 'Hexagon',
  'star': 'Star',
};

/**
 * Build the SVG `points` attribute for a polygon shape inscribed in the
 * bounding box `[inset, inset] → [w-inset, h-inset]`. The inset accounts
 * for stroke width — SVG centers strokes on the edge, so without the
 * inset half the stroke would clip outside the node bounds.
 */
function polygonPoints(kind: ShapeKind, w: number, h: number, inset: number): string {
  const cx = w / 2;
  const cy = h / 2;
  const halfW = Math.max(0, w / 2 - inset);
  const halfH = Math.max(0, h / 2 - inset);

  if (kind === 'triangle') {
    // Apex at top-center, base along the bottom.
    return [
      [cx, inset],
      [w - inset, h - inset],
      [inset, h - inset],
    ]
      .map((p) => p.join(','))
      .join(' ');
  }

  if (kind === 'diamond') {
    // Rhombus stretched to the bounding box.
    return [
      [cx, inset],
      [w - inset, cy],
      [cx, h - inset],
      [inset, cy],
    ]
      .map((p) => p.join(','))
      .join(' ');
  }

  if (kind === 'hexagon') {
    // Flat-top hexagon; the flat sides follow the left/right edges so it
    // scales gracefully to wide bounding boxes. `shoulder` is the x-offset
    // of the top/bottom points from the center.
    const shoulder = halfW / 2;
    return [
      [cx - shoulder, cy - halfH],
      [cx + shoulder, cy - halfH],
      [w - inset, cy],
      [cx + shoulder, cy + halfH],
      [cx - shoulder, cy + halfH],
      [inset, cy],
    ]
      .map((p) => p.join(','))
      .join(' ');
  }

  if (kind === 'star') {
    // 5-pointed star with the top point pointing up. Inner radius is 40%
    // of the outer radius — a conventional proportion that reads clearly
    // at any size without looking spiky or bloated.
    const innerRx = halfW * 0.4;
    const innerRy = halfH * 0.4;
    const points: string[] = [];
    for (let i = 0; i < 10; i++) {
      const isOuter = i % 2 === 0;
      const angle = -Math.PI / 2 + (i * Math.PI) / 5;
      const rx = isOuter ? halfW : innerRx;
      const ry = isOuter ? halfH : innerRy;
      points.push(`${cx + rx * Math.cos(angle)},${cy + ry * Math.sin(angle)}`);
    }
    return points.join(' ');
  }

  return '';
}

export interface ShapePrimitiveProps {
  kind: ShapeKind;
  width: number;
  height: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
}

/**
 * Render a single SVG primitive for a shape kind. Used by the shape node
 * body, the drag-to-draw preview, and the toolbar icons — keeping the
 * geometry in one place so all three views stay in sync.
 */
export const ShapePrimitive = ({
  kind,
  width,
  height,
  fill,
  stroke,
  strokeWidth,
}: ShapePrimitiveProps) => {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const sw = Math.max(0, strokeWidth);
  const inset = sw / 2;
  const common = {
    fill,
    stroke,
    strokeWidth: sw,
    strokeLinejoin: 'round' as const,
  };

  if (kind === 'rect' || kind === 'rounded-rect') {
    // Corner radius scales with the smaller dimension so a 400×50 pill
    // still looks like a pill rather than a slightly-rounded rectangle.
    const r = kind === 'rounded-rect' ? Math.min(w, h) * 0.18 : 0;
    return (
      <rect
        x={inset}
        y={inset}
        width={Math.max(0, w - sw)}
        height={Math.max(0, h - sw)}
        rx={r}
        ry={r}
        {...common}
      />
    );
  }

  if (kind === 'ellipse') {
    return (
      <ellipse
        cx={w / 2}
        cy={h / 2}
        rx={Math.max(0, w / 2 - inset)}
        ry={Math.max(0, h / 2 - inset)}
        {...common}
      />
    );
  }

  return <polygon points={polygonPoints(kind, w, h, inset)} {...common} />;
};
