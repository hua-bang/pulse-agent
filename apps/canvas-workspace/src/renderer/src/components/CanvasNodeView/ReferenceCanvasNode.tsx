import type { CSSProperties, FocusEvent, KeyboardEvent, MouseEvent, RefObject } from 'react';
import type { CanvasNode, ReferenceNodeData } from '../../types';
import { OpenSourceButton } from './NodeButtons';
import { NodeResizeHandles } from './NodeResizeHandles';
import { NodeTypeBadge } from './NodeTypeBadge';
import type { ReferenceSourceRenderer, ResizeHandlerFactory } from './types';

interface ReferenceCanvasNodeProps {
  classes: string;
  handleClose: (e: MouseEvent) => void;
  handleHeaderMouseDown: (e: MouseEvent) => void;
  handleNodeBodyMouseDown: (e: MouseEvent) => void;
  handleNodeClick: (e: MouseEvent) => void;
  handleOpenReferenceSource: (e: MouseEvent) => void;
  handleTitleBlur: (e: FocusEvent<HTMLSpanElement>) => void;
  handleTitleDoubleClick: (e: MouseEvent) => void;
  handleTitleKeyDown: (e: KeyboardEvent<HTMLSpanElement>) => void;
  isEditingTitle: boolean;
  isFullscreen: boolean;
  isSelected: boolean;
  makeResizeHandler: ResizeHandlerFactory;
  node: CanvasNode;
  readOnly: boolean;
  renderReferenceSource: ReferenceSourceRenderer;
  resolved?: { node?: CanvasNode; workspaceName?: string };
  titleRef: RefObject<HTMLSpanElement>;
  wrapperStyle: CSSProperties;
}

export const ReferenceCanvasNode = ({
  classes,
  handleClose,
  handleHeaderMouseDown,
  handleNodeBodyMouseDown,
  handleNodeClick,
  handleOpenReferenceSource,
  handleTitleBlur,
  handleTitleDoubleClick,
  handleTitleKeyDown,
  isEditingTitle,
  isFullscreen,
  isSelected,
  makeResizeHandler,
  node,
  readOnly,
  renderReferenceSource,
  resolved,
  titleRef,
  wrapperStyle,
}: ReferenceCanvasNodeProps) => {
  const sourceNode = resolved?.node;
  const refData = node.data as ReferenceNodeData;
  const workspaceLabel = resolved?.workspaceName ?? refData.workspaceNameSnapshot ?? 'Workspace';

  return (
    <div className={classes} style={wrapperStyle} onClick={handleNodeClick}>
      <div
        className="node-header"
        onMouseDown={isFullscreen ? undefined : handleHeaderMouseDown}
      >
        <NodeTypeBadge type="reference" />
        <span
          ref={titleRef}
          className="node-title"
          contentEditable={isEditingTitle}
          suppressContentEditableWarning
          spellCheck={false}
          onBlur={handleTitleBlur}
          onKeyDown={isEditingTitle ? handleTitleKeyDown : undefined}
          onDoubleClick={handleTitleDoubleClick}
          onMouseDown={(e) => {
            if (isEditingTitle) e.stopPropagation();
          }}
        >
          {node.title}
        </span>
        <span className="node-reference-source" title={workspaceLabel}>{workspaceLabel}</span>
        <OpenSourceButton onClick={handleOpenReferenceSource} disabled={!sourceNode} />
        {readOnly ? null : (
          <button
            className="node-close"
            type="button"
            onClick={handleClose}
            onMouseDown={(e) => e.stopPropagation()}
            title="Remove"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>
      <div
        className="node-body node-body--reference"
        onMouseDown={handleNodeBodyMouseDown}
      >
        {/* The transparent drag surface lets the whole card be moved by its
            body and stops the embedded webview / iframe from swallowing the
            mousedown (or stealing scroll / clicks while you pan the canvas).
            We drop it once the card is selected: selecting signals intent to
            use the content, so the preview turns interactive (scroll / click)
            and the card is moved by its header pill instead. Deselecting
            restores the overlay. Fullscreen drops it for the same reason —
            interacting with the full-size node is the whole point. */}
        {isFullscreen || isSelected ? null : (
          <div
            className="reference-drag-overlay"
            onMouseDown={handleHeaderMouseDown}
            onClick={handleNodeClick}
            onDoubleClick={handleOpenReferenceSource}
          />
        )}
        {sourceNode ? (
          renderReferenceSource(sourceNode, workspaceLabel)
        ) : (
          <div className="reference-node-missing">
            <div className="reference-node-missing__title">Source unavailable</div>
            <div className="reference-node-missing__meta">
              {refData.titleSnapshot || node.title}
            </div>
          </div>
        )}
      </div>
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
