import type React from 'react';
import type { CanvasNode, EdgeAnchor } from '../../../../../types';
import './index.css';

const SIDES: Array<Exclude<EdgeAnchor, 'auto'>> = ['top', 'right', 'bottom', 'left'];

interface Props {
  node: CanvasNode;
  onHandleMouseDown: (nodeId: string, event: React.MouseEvent) => void;
}

/**
 * Side-midpoint connect handles for the hovered node. Dragging any handle
 * starts an auto-anchored edge, so the committed edge still picks the side
 * that faces its target.
 */
export const CanvasConnectHandles = ({ node, onHandleMouseDown }: Props) => (
  <div
    className="canvas-connect-handles"
    style={{ left: node.x, top: node.y, width: node.width, height: node.height }}
  >
    {SIDES.map((side) => (
      <div
        key={side}
        className={`canvas-connect-handle canvas-connect-handle--${side}`}
        data-side={side}
        onMouseDown={(event) => onHandleMouseDown(node.id, event)}
      />
    ))}
  </div>
);
