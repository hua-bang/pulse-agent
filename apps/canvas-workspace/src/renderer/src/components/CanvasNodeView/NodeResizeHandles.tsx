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

  // Body handles: left/right edges + the two bottom corners + bottom edge.
  // These resize the body while leaving the top edge free for the header /
  // drag-to-move. Text and group nodes opt out (text auto-sizes; group resize
  // is derived from its children).
  const showBodyHandles = variant === 'floating' || (nodeType !== 'text' && nodeType !== 'group');
  // Frames carry a header pill that floats ABOVE the body, so their top edge
  // is free too — only frames also get the top edge and the two top corners
  // (full 8-direction resize).
  const showTopHandles = nodeType === 'frame';

  return (
    <>
      <div
        className="resize-handle resize-handle--right"
        onMouseDown={makeResizeHandler('right')}
      />
      {showBodyHandles && (
        <>
          <div
            className="resize-handle resize-handle--left"
            onMouseDown={makeResizeHandler('left')}
          />
          <div
            className="resize-handle resize-handle--bottom"
            onMouseDown={makeResizeHandler('bottom')}
          />
          <div
            className="resize-handle resize-handle--corner"
            onMouseDown={makeResizeHandler('bottom-right')}
          />
          <div
            className="resize-handle resize-handle--bottom-left"
            onMouseDown={makeResizeHandler('bottom-left')}
          />
        </>
      )}
      {showTopHandles && (
        <>
          <div
            className="resize-handle resize-handle--top"
            onMouseDown={makeResizeHandler('top')}
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
