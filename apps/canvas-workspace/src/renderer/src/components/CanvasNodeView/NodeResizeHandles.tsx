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

  return (
    <>
      <div
        className="resize-handle resize-handle--right"
        onMouseDown={makeResizeHandler('right')}
      />
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
    </>
  );
};
