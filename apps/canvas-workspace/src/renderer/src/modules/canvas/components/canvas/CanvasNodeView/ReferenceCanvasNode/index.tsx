import './index.css';
import { lazy, Suspense, type CSSProperties, type FocusEvent, type KeyboardEvent, type MouseEvent, type RefObject } from 'react';
import type { CanvasNode, ReferenceNodeData } from '../../../../../../types';
import { useI18n } from '../../../../../../i18n';
import { OpenSourceButton, AddToChatButton, FullscreenButton, FocusButton } from '../NodeButtons';
import { NodeResizeHandles } from '../NodeResizeHandles';
import { NodeTypeBadge } from '../NodeTypeBadge';
import type { ReferenceSourceRenderer, ResizeHandlerFactory } from '../types';
import type { ResolvedReference } from '../../../../../../shared/reference/types';

// Whole-canvas references are rare, so their preview loads on first use.
const WorkspaceReferencePreview = lazy(() =>
  import('./WorkspaceReferencePreview').then((module) => ({ default: module.WorkspaceReferencePreview })),
);

interface ReferenceCanvasNodeProps {
  classes: string;
  handleClose: (e: MouseEvent) => void;
  handleAddToChat?: (e: MouseEvent) => void;
  handleFocus?: (e: MouseEvent) => void;
  handleToggleFullscreen?: (e: MouseEvent) => void;
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
  resolved?: ResolvedReference;
  titleRef: RefObject<HTMLSpanElement>;
  wrapperStyle: CSSProperties;
}

export const ReferenceCanvasNode = ({
  classes,
  handleClose,
  handleAddToChat,
  handleFocus,
  handleToggleFullscreen,
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
  const { t } = useI18n();
  const sourceNode = resolved?.node;
  const refData = node.data as ReferenceNodeData;
  const workspaceLabel = resolved?.workspaceName ?? refData.workspaceNameSnapshot ?? 'Workspace';
  const canvasRef = node.ref?.kind === 'workspace' ? node.ref : undefined;
  const canOpenSource = canvasRef ? resolved?.workspaceName !== undefined : Boolean(sourceNode);

  return (
    <div className={classes} style={wrapperStyle} onClick={handleNodeClick}>
      <div
        className="node-header"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <NodeTypeBadge type="reference" />
        <span
          ref={titleRef}
          className="node-title"
          contentEditable={isEditingTitle}
          role={isEditingTitle ? 'textbox' : undefined}
          aria-label={isEditingTitle ? t('workspaceNodes.editTitle') : undefined}
          aria-multiline={isEditingTitle ? false : undefined}
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
        {handleAddToChat && <AddToChatButton onClick={handleAddToChat} />}
        {handleToggleFullscreen && <FullscreenButton isFullscreen={isFullscreen} onClick={handleToggleFullscreen} />}
        {handleFocus && <FocusButton onClick={handleFocus} />}
        <OpenSourceButton onClick={handleOpenReferenceSource} disabled={!canOpenSource} />
        {readOnly ? null : (
          <button
            className="node-close"
            type="button"
            onClick={handleClose}
            onMouseDown={(e) => e.stopPropagation()}
            title="Remove"
            aria-label="Remove"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>
      {isFullscreen || readOnly ? null : (
        <div
          className="reference-drag-handle"
          onMouseDown={handleHeaderMouseDown}
          aria-hidden="true"
        />
      )}
      <div
        className="node-body node-body--reference"
        onMouseDown={handleNodeBodyMouseDown}
      >
        {/* Reference cards use exactly one drag affordance: the floating handle
            at the top-left. The embedded source stays interactive at every
            selection state, so iframe/webview mouse capture cannot leave the
            card in a sticky drag. */}
        {isFullscreen ? null : (
          <div
            className="reference-drag-overlay"
          />
        )}
        {canvasRef ? (
          <Suspense fallback={null}>
            <WorkspaceReferencePreview
              workspaceId={canvasRef.workspaceId}
              workspaceName={resolved?.workspaceName}
              workspaceNodes={resolved?.workspaceNodes}
              nameSnapshot={refData.workspaceNameSnapshot || node.title}
              onOpen={handleOpenReferenceSource}
            />
          </Suspense>
        ) : sourceNode ? (
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

