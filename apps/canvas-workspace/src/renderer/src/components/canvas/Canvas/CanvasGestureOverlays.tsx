import type React from 'react';
import type { NodeDragPreview } from '../../../hooks/useNodeDrag';
import type { NodeResizePreview } from '../../../hooks/useNodeResize';
import type { MarqueeRect } from '../../../hooks/useMarqueeSelect';
import type { ShapeDraft } from '../../../hooks/useShapeDraw';
import { ShapePrimitive } from '../../../utils/shapeGeometry';
import { useI18n } from '../../../i18n';

/**
 * Transient, gesture-scoped visuals for the canvas surface: the marquee box,
 * the shape draft outline, and the drag/resize HUD. Split out of
 * `CanvasSurface` because none of them touch the surface's transform,
 * lifecycle, or node wiring — they only render whatever the in-flight
 * gesture reports.
 */
/**
 * Dashed rectangle drawn while the user box-selects on blank canvas.
 * Lives inside `.canvas-transform` so the box scales with zoom and
 * pans with the rest of the surface — matches the convention that
 * canvas-coordinate UI renders here, not in the screen-space overlay
 * layer. The border width is divided by the zoom (same trick as
 * CanvasAlignmentGuides) so it reads as ~1px on screen at any scale.
 */
export const MarqueePreview = ({ rect, scale }: { rect: MarqueeRect; scale: number }) => {
  if (rect.width <= 0 && rect.height <= 0) return null;
  const borderPx = 1 / Math.max(scale, 0.0001);
  return (
    <div
      className="canvas-marquee"
      style={{
        position: 'absolute',
        left: rect.x,
        top: rect.y,
        width: Math.max(1, rect.width),
        height: Math.max(1, rect.height),
        border: `${borderPx}px solid #5B7CBF`,
        background: 'rgba(91, 124, 191, 0.08)',
        pointerEvents: 'none',
        boxSizing: 'border-box',
      }}
    />
  );
};

/**
 * Dashed outline shown while the user drags out a new shape. Lives inside
 * `.canvas-transform`, so canvas coords render correctly at any zoom/pan.
 * Pointer events are disabled so the overlay above it still receives the
 * ongoing mousemove/mouseup.
 */
export const ShapeDraftPreview = ({ draft, scale }: { draft: ShapeDraft; scale: number }) => {
  const x = Math.min(draft.start.x, draft.current.x);
  const y = Math.min(draft.start.y, draft.current.y);
  const w = Math.max(1, Math.abs(draft.current.x - draft.start.x));
  const h = Math.max(1, Math.abs(draft.current.y - draft.start.y));
  return (
    <svg
      className="shape-draft-preview"
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: w,
        height: h,
        pointerEvents: 'none',
        overflow: 'visible',
      }}
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
    >
      <ShapePrimitive
        kind={draft.kind}
        width={w}
        height={h}
        fill="rgba(91, 124, 191, 0.08)"
        stroke="#5B7CBF"
        strokeWidth={1.5 / Math.max(scale, 0.0001)}
      />
    </svg>
  );
};

interface GestureHudProps {
  dragPreview?: NodeDragPreview | null;
  resizePreview?: NodeResizePreview | null;
  scale: number;
}

export const CanvasGestureHud = ({ dragPreview, resizePreview, scale }: GestureHudProps) => {
  const { t } = useI18n();
  const preview = dragPreview
    ? {
        x: dragPreview.x,
        y: dragPreview.y,
        width: dragPreview.width,
        height: dragPreview.height,
      }
    : resizePreview
      ? {
          x: resizePreview.x,
          y: resizePreview.y,
          width: resizePreview.width,
          height: resizePreview.height,
        }
      : null;

  if (!preview) return null;

  const safeScale = Math.max(scale, 0.0001);
  const label = dragPreview
    ? dragPreview.count > 1
      ? t('canvas.gesture.movingMany', { count: dragPreview.count })
      : t('canvas.gesture.movingOne')
    : t('canvas.gesture.resizing');
  const dimensions = `${Math.round(preview.width)} x ${Math.round(preview.height)}`;
  const position = dragPreview
    ? `X ${Math.round(preview.x)}  Y ${Math.round(preview.y)}`
    : null;

  return (
    <div
      className="canvas-gesture-hud"
      aria-hidden="true"
      style={{
        left: preview.x,
        top: preview.y + preview.height + (8 / safeScale),
        transform: `scale(${1 / safeScale})`,
      } as React.CSSProperties}
    >
      <div className="canvas-gesture-hud__main">
        <span>{label}</span>
        {dragPreview?.snapDisabled && (
          <span className="canvas-gesture-hud__badge">{t('canvas.gesture.freeMove')}</span>
        )}
      </div>
      <div className="canvas-gesture-hud__meta">
        {position && <span>{position}</span>}
        <span>{dimensions}</span>
      </div>
    </div>
  );
};
