import { useCallback, type CSSProperties, type MouseEvent } from 'react';
import type { CanvasNode, ImageNodeData } from '../../../../../types';
import { copyTextToClipboard } from '../../../../../utils/clipboard';
import { toFileUrl } from '../../../../../utils/fileUrl';
import { useAppShell } from '../../../../../shared/appShell';
import { useI18n } from '../../../../../i18n';
import { ImageNodeBody } from '../../node-bodies/ImageNodeBody';
import { AddToChatButton, CloseButton, CopyImageButton, FullscreenButton, OpenDetailButton } from './NodeButtons';
import { NodeResizeHandles } from './NodeResizeHandles';
import type { ResizeHandlerFactory } from './types';
import { isCanvasPanGesture } from './utils';

interface ImageCanvasNodeProps {
  classes: string;
  handleAddToChat?: (e: MouseEvent) => void;
  handleClose: (e: MouseEvent) => void;
  handleOpenDetail?: (e: MouseEvent) => void;
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
  handleAddToChat,
  handleClose,
  handleOpenDetail,
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
  const { t } = useI18n();
  const data = node.data as ImageNodeData;
  const imageFilePath = data.filePath;

  const handleCopyImage = useCallback((e: MouseEvent) => {
    e.stopPropagation();
    if (!imageFilePath) {
      notify({ tone: 'error', title: t('canvas.node.image.noImage') });
      return;
    }

    void window.canvasWorkspace.file.copyImage(imageFilePath).then((result) => {
      if (result.ok) {
        notify({ tone: 'success', title: t('canvas.node.image.copied') });
        return;
      }

      void copyTextToClipboard(toFileUrl(imageFilePath)).then(() => {
        notify({
          tone: 'success',
          title: t('canvas.node.image.linkCopied'),
          description: t('canvas.node.image.linkCopiedDesc'),
        });
      }).catch(() => {
        notify({
          tone: 'error',
          title: t('canvas.node.image.copyFailed'),
          description: result.error ?? t('canvas.node.image.copyFailedDesc'),
        });
      });
    }).catch((err) => {
      notify({
        tone: 'error',
        title: t('canvas.node.image.copyFailed'),
        description: err instanceof Error ? err.message : String(err),
      });
    });
  }, [imageFilePath, notify, t]);

  return (
    <div className={classes} data-node-id={node.id} style={wrapperStyle} onClick={handleNodeClick}>
      <div
        className="node-body node-body--image"
        onMouseDown={(e) => {
          if (!isCanvasPanGesture(e)) e.stopPropagation();
        }}
      >
        <ImageNodeBody
          node={node}
          isFullscreen={isFullscreen}
          onSelect={onSelect}
          onDragStart={onDragStart}
          readOnly={readOnly}
        />
      </div>
      {imageFilePath ? <CopyImageButton onClick={handleCopyImage} /> : null}
      {handleAddToChat ? <AddToChatButton floating onClick={handleAddToChat} /> : null}
      {handleOpenDetail ? <OpenDetailButton floating onClick={handleOpenDetail} /> : null}
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
