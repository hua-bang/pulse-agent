import type { CSSProperties, MouseEvent } from 'react';
import type { CanvasNode } from '../../types';
import { ImageNodeBody } from '../ImageNodeBody';
import { CloseButton, FullscreenButton } from './NodeButtons';
import { NodeResizeHandles } from './NodeResizeHandles';
import type { ResizeHandlerFactory } from './types';

interface ImageCanvasNodeProps {
  classes: string;
  handleClose: (e: MouseEvent) => void;
  handleNodeClick: (e: MouseEvent) => void;
  handleToggleFullscreen: (e: MouseEvent) => void;
  isFullscreen: boolean;
  makeResizeHandler: ResizeHandlerFactory;
  node: CanvasNode;
  onDragStart: (e: MouseEvent, node: CanvasNode) => void;
  onSelect: (id: string, mods?: { shift?: boolean; meta?: boolean }) => void;
  readOnly: boolean;
  supportsFullscreen: boolean;
  wrapperStyle: CSSProperties;
}

export const ImageCanvasNode = ({
  classes,
  handleClose,
  handleNodeClick,
  handleToggleFullscreen,
  isFullscreen,
  makeResizeHandler,
  node,
  onDragStart,
  onSelect,
  readOnly,
  supportsFullscreen,
  wrapperStyle,
}: ImageCanvasNodeProps) => (
  <div className={classes} style={wrapperStyle} onClick={handleNodeClick}>
    <div className="node-body node-body--image" onMouseDown={(e) => e.stopPropagation()}>
      <ImageNodeBody node={node} onSelect={onSelect} onDragStart={onDragStart} readOnly={readOnly} />
    </div>
    {supportsFullscreen ? (
      <FullscreenButton floating isFullscreen={isFullscreen} onClick={handleToggleFullscreen} />
    ) : null}
    {readOnly ? null : <CloseButton floating onClick={handleClose} />}
    <NodeResizeHandles
      isFullscreen={isFullscreen}
      makeResizeHandler={makeResizeHandler}
      nodeType={node.type}
      readOnly={readOnly}
      variant="floating"
    />
  </div>
);
