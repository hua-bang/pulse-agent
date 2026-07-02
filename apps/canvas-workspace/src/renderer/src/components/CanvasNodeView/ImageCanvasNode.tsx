import { useCallback, type CSSProperties, type MouseEvent } from 'react';
import type { CanvasNode, ImageNodeData } from '../../types';
import { copyTextToClipboard } from '../../utils/clipboard';
import { toFileUrl } from '../../utils/fileUrl';
import { useAppShell } from '../AppShellProvider';
import { ImageNodeBody } from '../ImageNodeBody';
import { CloseButton, CopyImageButton, FullscreenButton } from './NodeButtons';
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
}: ImageCanvasNodeProps) => {
  const { notify } = useAppShell();
  const data = node.data as ImageNodeData;
  const imageFilePath = data.filePath;

  const handleCopyImage = useCallback((e: MouseEvent) => {
    e.stopPropagation();
    if (!imageFilePath) {
      notify({ tone: 'error', title: 'No image to copy' });
      return;
    }

    void window.canvasWorkspace.file.copyImage(imageFilePath).then((result) => {
      if (result.ok) {
        notify({ tone: 'success', title: 'Image copied' });
        return;
      }

      void copyTextToClipboard(toFileUrl(imageFilePath)).then(() => {
        notify({
          tone: 'success',
          title: 'Image link copied',
          description: 'Image data could not be copied, so the file link was copied instead.',
        });
      }).catch(() => {
        notify({
          tone: 'error',
          title: 'Unable to copy image',
          description: result.error ?? 'The image file could not be copied.',
        });
      });
    }).catch((err) => {
      notify({
        tone: 'error',
        title: 'Unable to copy image',
        description: err instanceof Error ? err.message : String(err),
      });
    });
  }, [imageFilePath, notify]);

  return (
    <div className={classes} style={wrapperStyle} onClick={handleNodeClick}>
      <div className="node-body node-body--image" onMouseDown={(e) => e.stopPropagation()}>
        <ImageNodeBody node={node} onSelect={onSelect} onDragStart={onDragStart} readOnly={readOnly} />
      </div>
      {imageFilePath ? <CopyImageButton onClick={handleCopyImage} /> : null}
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
};
