import {
  useCallback,
  useState,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import type { AgentContextDomSelectionRef, CanvasNode } from '../../types';
import { AgentNodeBody } from '../AgentNodeBody';
import { DynamicAppNodeBody } from '../DynamicAppNodeBody';
import { FileNodeBody } from '../FileNodeBody';
import { FrameNodeBody } from '../FrameNodeBody';
import { IframeNodeBody } from '../IframeNodeBody';
import { PluginNodeBody } from '../PluginNodeBody';
import { TerminalNodeBody } from '../TerminalNodeBody';
import { TextNodeBody } from '../TextNodeBody';
import { useAppShell } from '../AppShellProvider';
import { CanvasNodeHeader } from './CanvasNodeHeader';
import { NodeResizeHandles } from './NodeResizeHandles';
import type { CanvasNodeRenderMode, ResizeHandlerFactory } from './types';

interface DefaultCanvasNodeProps {
  classes: string;
  fullscreenButton: ReactNode;
  getAllNodes?: () => CanvasNode[];
  containerDescendantCount: number;
  handleClose: (e: MouseEvent) => void;
  handleFocus: (e: MouseEvent) => void;
  handleHeaderMouseDown: (e: MouseEvent) => void;
  handleNodeBodyMouseDown: (e: MouseEvent) => void;
  handleNodeClick: (e: MouseEvent) => void;
  handleReference: (e: MouseEvent) => void;
  handleAddToChat: (e: MouseEvent) => void;
  handleTitleBlur: (e: FocusEvent<HTMLSpanElement>) => void;
  handleTitleDoubleClick: (e: MouseEvent) => void;
  handleTitleKeyDown: (e: KeyboardEvent<HTMLSpanElement>) => void;
  handleUngroup: (e: MouseEvent) => void;
  isEditingTitle: boolean;
  isFullscreen: boolean;
  isResizing: boolean;
  isSelected: boolean;
  makeResizeHandler: ResizeHandlerFactory;
  node: CanvasNode;
  onDragStart: (e: MouseEvent, node: CanvasNode) => void;
  onReference?: (nodeId: string) => void;
  onAddToChat?: (nodeId: string) => void;
  onAddDomSelectionToChat?: (selection: AgentContextDomSelectionRef) => void;
  onSelect: (id: string, mods?: { shift?: boolean; meta?: boolean }) => void;
  onRemoveNodes?: (ids: string[]) => void;
  onUngroupSelectedGroups?: () => void;
  onUpdate: (id: string, patch: Partial<CanvasNode>) => void;
  readOnly: boolean;
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
  getAllNodes,
  containerDescendantCount,
  handleClose,
  handleFocus,
  handleHeaderMouseDown,
  handleNodeBodyMouseDown,
  handleNodeClick,
  handleReference,
  handleAddToChat,
  handleTitleBlur,
  handleTitleDoubleClick,
  handleTitleKeyDown,
  handleUngroup,
  isEditingTitle,
  isFullscreen,
  isResizing,
  isSelected,
  makeResizeHandler,
  node,
  onDragStart,
  onReference,
  onAddToChat,
  onAddDomSelectionToChat,
  onSelect,
  onRemoveNodes,
  onUngroupSelectedGroups,
  onUpdate,
  readOnly,
  renderMode = 'full',
  relativeTime,
  rootFolder,
  titleRef,
  workspaceId,
  workspaceName,
  wrapperStyle,
}: DefaultCanvasNodeProps) => {
  const { notify } = useAppShell();
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
      containerDescendantCount={containerDescendantCount}
      handleClose={handleClose}
      handleFocus={handleFocus}
      handleHeaderMouseDown={handleHeaderMouseDown}
      handlePluginSelectElement={handlePluginSelectElement}
      handleReference={handleReference}
      handleAddToChat={handleAddToChat}
      handleTitleBlur={handleTitleBlur}
      handleTitleDoubleClick={handleTitleDoubleClick}
      handleTitleKeyDown={handleTitleKeyDown}
      handleUngroup={handleUngroup}
      isEditingTitle={isEditingTitle}
      isFullscreen={isFullscreen}
      isSelected={isSelected}
      node={node}
      pluginElementPickerActive={pluginElementPickerActive}
      onReference={onReference}
      onAddToChat={onAddToChat}
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
      {!frameBodyOnly && header}
      <div className="node-body" onMouseDown={handleNodeBodyMouseDown}>
        {node.type === 'file' ? (
          <FileNodeBody node={node} onUpdate={onUpdate} workspaceId={workspaceId} readOnly={readOnly} />
        ) : node.type === 'terminal' ? (
          <TerminalNodeBody node={node} getAllNodes={getAllNodes} rootFolder={rootFolder} workspaceId={workspaceId} workspaceName={workspaceName} onUpdate={onUpdate} readOnly={readOnly} />
        ) : node.type === 'frame' || node.type === 'group' ? (
          <FrameNodeBody
            node={node}
            getAllNodes={getAllNodes}
            onUpdate={onUpdate}
            onRemoveNodes={onRemoveNodes}
            rootFolder={rootFolder}
            workspaceId={workspaceId}
            workspaceName={workspaceName}
            readOnly={readOnly}
          />
        ) : node.type === 'text' ? (
          <TextNodeBody
            node={node}
            onUpdate={onUpdate}
            isSelected={isSelected}
            onSelect={onSelect}
            onDragStart={onDragStart}
            readOnly={readOnly}
          />
        ) : node.type === 'iframe' ? (
          <IframeNodeBody
            node={node}
            workspaceId={workspaceId}
            onUpdate={onUpdate}
            isResizing={isResizing}
            onAddDomSelectionToChat={onAddDomSelectionToChat}
            readOnly={readOnly}
          />
        ) : node.type === 'dynamic-app' ? (
          <DynamicAppNodeBody node={node} workspaceId={workspaceId} onUpdate={onUpdate} isResizing={isResizing} readOnly={readOnly} />
        ) : node.type === 'plugin' ? (
          <PluginNodeBody node={node} workspaceId={workspaceId} workspaceName={workspaceName} onUpdate={onUpdate} isSelected={isSelected} readOnly={readOnly} />
        ) : (
          <AgentNodeBody node={node} getAllNodes={getAllNodes} rootFolder={rootFolder} workspaceId={workspaceId} workspaceName={workspaceName} onUpdate={onUpdate} readOnly={readOnly} />
        )}
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
