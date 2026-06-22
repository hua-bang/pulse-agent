import type { CanvasNode } from '../../types';
import type { ResizeHandlerFactory } from './types';

interface NodeResizeHandlesProps {
  isFullscreen: boolean;
  makeResizeHandler: ResizeHandlerFactory;
  nodeType: CanvasNode['type'];
  readOnly: boolean;
  variant?: 'floating' | 'default';
}

export const NodeResizeHandles = ({
  isFullscreen,
  makeResizeHandler,
  nodeType,
  readOnly,
  variant = 'default',
}: NodeResizeHandlesProps) => {
  if (readOnly || isFullscreen) return null;

  const showBottomHandles = variant === 'floating' || (nodeType !== 'text' && nodeType !== 'group');
  // Frames carry a header pill that floats above the body, so the body's top
  // edge is free and they support full 8-direction resize. Other node types
  // keep right/bottom/corner only — their top edge is occupied by the header.
  const showAllEdges = nodeType === 'frame';

  return (
    <>
      <div
        className="resize-handle resize-handle--right"
        onMouseDown={makeResizeHandler('right')}
      />
      {showAllEdges && (
        <div
          className="resize-handle resize-handle--left"
          onMouseDown={makeResizeHandler('left')}
        />
      )}
      {showBottomHandles && (
        <>
          <div
            className="resize-handle resize-handle--bottom"
            onMouseDown={makeResizeHandler('bottom')}
          />
          <div
            className="resize-handle resize-handle--corner"
            onMouseDown={makeResizeHandler('bottom-right')}
          />
        </>
      )}
      {showAllEdges && (
        <>
          <div
            className="resize-handle resize-handle--top"
            onMouseDown={makeResizeHandler('top')}
          />
          <div
            className="resize-handle resize-handle--bottom-left"
            onMouseDown={makeResizeHandler('bottom-left')}
          />
          <div
            className="resize-handle resize-handle--top-left"
            onMouseDown={makeResizeHandler('top-left')}
          />
          <div
            className="resize-handle resize-handle--top-right"
            onMouseDown={makeResizeHandler('top-right')}
          />
        </>
      )}
    </>
  );
};
