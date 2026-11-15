import './index.css';
import { useRef, type PointerEvent } from 'react';
import type { CanvasNode, CanvasTransform } from '../../../../../types';
import { useI18n } from '../../../../../i18n';
import { isContainerNode } from '../../../../../utils/frameHierarchy';
import {
  fitMinimap,
  toCanvasPoint,
  toMinimapRect,
  unionRect,
  viewportCanvasRect,
} from './model';

const MAP_WIDTH = 200;
const MAP_HEIGHT = 136;
const MAP_PADDING = 8;

interface Props {
  nodes: CanvasNode[];
  transform: CanvasTransform;
  viewport: { width: number; height: number };
  /** Pan so a canvas point sits at the view centre. */
  onCenterOn: (x: number, y: number) => void;
}

/**
 * Overview of the whole canvas with the visible area outlined. Press or drag
 * on the map to move the view there. Fit, zoom, and Cmd+K give keyboard
 * users the same reach, so the map itself is pointer-only.
 */
export const CanvasMinimap = ({ nodes, transform, viewport, onCenterOn }: Props) => {
  const { t } = useI18n();
  const svgRef = useRef<SVGSVGElement>(null);
  const viewRect = viewportCanvasRect(transform, viewport);
  const world = unionRect([...nodes, viewRect]) ?? viewRect;
  const layout = fitMinimap(world, { width: MAP_WIDTH, height: MAP_HEIGHT }, MAP_PADDING);
  // Containers first, so content nodes paint over their frames.
  const nodeRects = [...nodes]
    .sort((left, right) => Number(isContainerNode(right)) - Number(isContainerNode(left)))
    .map((node) => ({
      id: node.id,
      container: isContainerNode(node),
      rect: toMinimapRect(layout, node),
    }));
  const view = toMinimapRect(layout, viewRect);

  const centerOnPointer = (event: PointerEvent<SVGSVGElement>) => {
    const bounds = svgRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const point = toCanvasPoint(layout, event.clientX - bounds.left, event.clientY - bounds.top);
    onCenterOn(point.x, point.y);
  };

  return (
    <div className="canvas-minimap" onMouseDown={(event) => event.stopPropagation()}>
      <svg
        ref={svgRef}
        role="img"
        aria-label={t('canvas.minimap.label')}
        width={MAP_WIDTH}
        height={MAP_HEIGHT}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          centerOnPointer(event);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) centerOnPointer(event);
        }}
      >
        {nodeRects.map(({ id, container, rect }) => (
          <rect
            key={id}
            className={container ? 'canvas-minimap__frame' : 'canvas-minimap__node'}
            x={rect.x}
            y={rect.y}
            width={Math.max(rect.width, 1)}
            height={Math.max(rect.height, 1)}
            rx={1}
          />
        ))}
        <rect
          className="canvas-minimap__view"
          x={view.x}
          y={view.y}
          width={view.width}
          height={view.height}
          rx={2}
        />
      </svg>
    </div>
  );
};
