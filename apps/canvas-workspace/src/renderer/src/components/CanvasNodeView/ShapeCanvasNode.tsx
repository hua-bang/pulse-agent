import type { CSSProperties, MouseEvent } from 'react';
import type { CanvasNode } from '../../types';
import { ShapeNodeBody, ShapeStylePicker } from '../ShapeNodeBody';
import { CloseButton } from './NodeButtons';
import { NodeResizeHandles } from './NodeResizeHandles';
import type { ResizeHandlerFactory } from './types';

interface ShapeCanvasNodeProps {
  classes: string;
  handleClose: (e: MouseEvent) => void;
  handleNodeClick: (e: MouseEvent) => void;
  isSelected: boolean;
  makeResizeHandler: ResizeHandlerFactory;
  node: CanvasNode;
  onDragStart: (e: MouseEvent, node: CanvasNode) => void;
  onSelect: (id: string, mods?: { shift?: boolean; meta?: boolean }) => void;
  onUpdate: (id: string, patch: Partial<CanvasNode>) => void;
  readOnly: boolean;
  wrapperStyle: CSSProperties;
}

export const ShapeCanvasNode = ({
  classes,
  handleClose,
  handleNodeClick,
  isSelected,
  makeResizeHandler,
  node,
  onDragStart,
  onSelect,
  onUpdate,
  readOnly,
  wrapperStyle,
}: ShapeCanvasNodeProps) => (
  <div className={classes} style={wrapperStyle} onClick={handleNodeClick}>
    <div className="node-body node-body--shape" onMouseDown={(e) => e.stopPropagation()}>
      <ShapeNodeBody
        node={node}
        isSelected={isSelected}
        onSelect={onSelect}
        onDragStart={onDragStart}
        onUpdate={onUpdate}
        readOnly={readOnly}
      />
    </div>
    {isSelected && !readOnly && <ShapeStylePicker node={node} onUpdate={onUpdate} />}
    {readOnly ? null : <CloseButton floating onClick={handleClose} />}
    <NodeResizeHandles
      isFullscreen={false}
      makeResizeHandler={makeResizeHandler}
      nodeType={node.type}
      readOnly={readOnly}
      variant="floating"
    />
  </div>
);
