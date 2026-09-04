import {
  useCallback,
  useState,
  type CSSProperties,
  type ClipboardEvent,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import type { AgentContextDomReviewComment, AgentContextDomSelectionRef, CanvasNode } from '../../../../../types';
import { useAppShell } from '../../../../../shared/appShell';
import { useRightDock } from '../../../../../shared/dockPort';
import { CanvasNodeHeader } from './CanvasNodeHeader';
import { CanvasNodeBody } from './CanvasNodeBody';
import { NodeResizeHandles } from './NodeResizeHandles';
import type { CanvasNodeRenderMode, ResizeHandlerFactory } from './types';
import { dispatchOpenNodePage } from '../../../../../utils/openNodeBridge';
import type { ChatDeliveryReceipt } from '../../../../chat';

interface DefaultCanvasNodeProps {
  classes: string;
  fullscreenButton: ReactNode;
  focusAction?: {
    ariaLabel: string;
    title: string;
  };
  getAllNodes?: () => CanvasNode[];
  containerDescendantCount: number;
  handleClose: (e: MouseEvent) => void;
  handleFocus: (e: MouseEvent) => void;
  handleHeaderMouseDown: (e: MouseEvent) => void;
  handleNodeBodyMouseDown: (e: MouseEvent) => void;
  handleNodeClick: (e: MouseEvent) => void;
  handleAddToChat: (e: MouseEvent) => void;
  handleAddToCanvas: (e: MouseEvent) => void;
  handleTitleBlur: (e: FocusEvent<HTMLSpanElement>) => void;
  handleTitleDoubleClick: (e: MouseEvent) => void;
  handleTitleKeyDown: (e: KeyboardEvent<HTMLSpanElement>) => void;
  handleTitlePaste: (e: ClipboardEvent<HTMLSpanElement>) => void;
  handleUngroup: (e: MouseEvent) => void;
  hideHeader: boolean;
  isEditingTitle: boolean;
  isFullscreen: boolean;
  isResizing: boolean;
  isSelected: boolean;
  makeResizeHandler: ResizeHandlerFactory;
  node: CanvasNode;
  onDragStart: (e: MouseEvent, node: CanvasNode) => void;
  onAddToChat?: (nodeId: string) => void | Promise<ChatDeliveryReceipt>;
  onAddToCanvas?: (nodeId: string) => void;
  onAddDomSelectionToChat?: (selection: AgentContextDomSelectionRef) => Promise<ChatDeliveryReceipt>;
  onSubmitDomReviewComments?: (comments: AgentContextDomReviewComment[]) => Promise<boolean>;
  onSelect: (id: string, mods?: { shift?: boolean; meta?: boolean }) => void;
  onRemoveNodes?: (ids: string[]) => void;
  onUngroupSelectedGroups?: () => void;
  onUpdate: (id: string, patch: Partial<CanvasNode>) => void | Promise<void>;
  readOnly: boolean;
  renderFullFileBody: boolean;
  renderMode?: CanvasNodeRenderMode;
  relativeTime: string | null;
  rootFolder?: string;
  titleRef: RefObject<HTMLSpanElement>;
  workspaceId?: string;
  workspaceName?: string;
  wrapperStyle: CSSProperties;
}

export const DefaultCanvasNode = ({
  classes,
  fullscreenButton,
  focusAction,
  getAllNodes,
  containerDescendantCount,
  handleClose,
  handleFocus,
  handleHeaderMouseDown,
  handleNodeBodyMouseDown,
  handleNodeClick,
  handleAddToChat,
  handleAddToCanvas,
  handleTitleBlur,
  handleTitleDoubleClick,
  handleTitleKeyDown,
  handleTitlePaste,
  handleUngroup,
  hideHeader,
  isEditingTitle,
  isFullscreen,
  isResizing,
  isSelected,
  makeResizeHandler,
  node,
  onDragStart,
  onAddToChat,
  onAddToCanvas,
  onAddDomSelectionToChat,
  onSubmitDomReviewComments,
  onSelect,
  onRemoveNodes,
  onUngroupSelectedGroups,
  onUpdate,
  readOnly,
  renderFullFileBody,
  renderMode = 'full',
  relativeTime,
  rootFolder,
  titleRef,
  workspaceId,
  workspaceName,
  wrapperStyle,
}: DefaultCanvasNodeProps) => {
  const { notify } = useAppShell();
  const { openNodeDetail } = useRightDock();
  const [pluginElementPickerActive, setPluginElementPickerActive] = useState(false);

  const handlePluginSelectElement = useCallback((event: MouseEvent) => {
    event.stopPropagation();
    if (!workspaceId) {
      notify({
        tone: 'error',
        title: 'Could not select element',
        description: 'This workspace is not ready yet.',
        autoCloseMs: 3200,
      });
      return;
    }

    if (pluginElementPickerActive) {
      setPluginElementPickerActive(false);
      void window.canvasWorkspace.iframe.cancelDomElementPick(workspaceId, node.id)
        .then((result) => {
          if (!result.ok) {
            console.warn('[plugin-node] failed to cancel DOM picker', result.error);
          }
        })
        .catch((err) => {
          console.warn('[plugin-node] failed to cancel DOM picker', err);
        });
      return;
    }

    setPluginElementPickerActive(true);
    void (async () => {
      try {
        const result = await window.canvasWorkspace.iframe.pickDomElement(workspaceId, node.id);
        if (result.ok && result.selection) {
          onAddDomSelectionToChat?.({
            ...result.selection,
            workspaceId,
            nodeId: node.id,
            nodeTitle: node.title,
          });
          notify({
            tone: 'success',
            title: 'DOM selection added',
            description: result.selection.label,
            autoCloseMs: 1800,
          });
          return;
        }

        if (!result.cancelled) {
          notify({
            tone: 'error',
            title: 'Could not select element',
            description: result.error ?? 'This plugin does not have an active webview yet.',
            autoCloseMs: 3600,
          });
        }
      } catch (err) {
        notify({
          tone: 'error',
          title: 'Could not select element',
          description: err instanceof Error ? err.message : String(err),
          autoCloseMs: 3600,
        });
      } finally {
        setPluginElementPickerActive(false);
      }
    })();
  }, [node.id, node.title, notify, onAddDomSelectionToChat, pluginElementPickerActive, workspaceId]);

  const handleOpenDetail = useCallback((event: MouseEvent) => {
    event.stopPropagation();
    dispatchOpenNodePage({ workspaceId: workspaceId ?? '', nodeId: node.id });
  }, [node.id, workspaceId]);

  const handleOpenTab = useCallback((event: MouseEvent) => {
    event.stopPropagation();
    if (!workspaceId) return;
    openNodeDetail(workspaceId, node.id, node.title.trim() || 'Untitled');
  }, [node.id, node.title, openNodeDetail, workspaceId]);

  const frameTitleOnly = node.type === 'frame' && renderMode === 'frame-title';
  const frameBodyOnly = node.type === 'frame' && renderMode === 'frame-body';
  const nodeClasses = [
    classes,
    frameTitleOnly && 'canvas-node--frame-title-overlay',
    frameBodyOnly && 'canvas-node--frame-body-layer',
  ].filter(Boolean).join(' ');
  const header = (
    <CanvasNodeHeader
      fullscreenButton={fullscreenButton}
      focusAction={focusAction}
      containerDescendantCount={containerDescendantCount}
      handleClose={handleClose}
      handleFocus={handleFocus}
      handleHeaderMouseDown={handleHeaderMouseDown}
      handleOpenDetail={handleOpenDetail}
      handleOpenTab={handleOpenTab}
      handlePluginSelectElement={handlePluginSelectElement}
      handleAddToChat={handleAddToChat}
      handleAddToCanvas={handleAddToCanvas}
      handleTitleBlur={handleTitleBlur}
      handleTitleDoubleClick={handleTitleDoubleClick}
      handleTitleKeyDown={handleTitleKeyDown}
      handleTitlePaste={handleTitlePaste}
      handleUngroup={handleUngroup}
      isEditingTitle={isEditingTitle}
      isFullscreen={isFullscreen}
      isSelected={isSelected}
      node={node}
      pluginElementPickerActive={pluginElementPickerActive}
      canOpenTab={Boolean(workspaceId)}
      onAddToChat={onAddToChat}
      onAddToCanvas={onAddToCanvas}
      onUngroupSelectedGroups={onUngroupSelectedGroups}
      onUpdate={onUpdate}
      readOnly={readOnly}
      relativeTime={relativeTime}
      titleRef={titleRef}
    />
  );

  if (frameTitleOnly) {
    return (
      <div className={nodeClasses} style={wrapperStyle} onClick={handleNodeClick}>
        {header}
      </div>
    );
  }

  return (
    <div className={nodeClasses} style={wrapperStyle} onClick={handleNodeClick}>
      {!frameBodyOnly && !hideHeader && header}
      <div className="node-body" onMouseDown={handleNodeBodyMouseDown}>
        <CanvasNodeBody
          node={node}
          getAllNodes={getAllNodes}
          rootFolder={rootFolder}
          workspaceId={workspaceId}
          workspaceName={workspaceName}
          onUpdate={onUpdate}
          onRemoveNodes={onRemoveNodes}
          onSelect={onSelect}
          onDragStart={onDragStart}
          onAddDomSelectionToChat={onAddDomSelectionToChat}
          onSubmitDomReviewComments={onSubmitDomReviewComments}
          isSelected={isSelected}
          isResizing={isResizing}
          renderFullFileBody={renderFullFileBody}
          readOnly={readOnly}
        />
      </div>
      <NodeResizeHandles
        isFullscreen={isFullscreen}
        makeResizeHandler={makeResizeHandler}
        nodeType={node.type}
        readOnly={readOnly}
      />
    </div>
  );
};
