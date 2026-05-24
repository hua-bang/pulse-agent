import type { CSSProperties, FocusEvent, KeyboardEvent, MouseEvent, ReactNode, RefObject } from 'react';
import type { CanvasNode } from '../../types';
import { AgentNodeBody } from '../AgentNodeBody';
import { FileNodeBody } from '../FileNodeBody';
import { FrameNodeBody } from '../FrameNodeBody';
import { IframeNodeBody } from '../IframeNodeBody';
import { TerminalNodeBody } from '../TerminalNodeBody';
import { TextNodeBody } from '../TextNodeBody';
import { CanvasNodeHeader } from './CanvasNodeHeader';
import { NodeResizeHandles } from './NodeResizeHandles';
import type { ResizeHandlerFactory } from './types';

interface DefaultCanvasNodeProps {
  classes: string;
  fullscreenButton: ReactNode;
  getAllNodes?: () => CanvasNode[];
  groupDescendantCount: number;
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
  onSelect: (id: string, mods?: { shift?: boolean; meta?: boolean }) => void;
  onUngroupSelectedGroups?: () => void;
  onUpdate: (id: string, patch: Partial<CanvasNode>) => void;
  readOnly: boolean;
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
  groupDescendantCount,
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
  onSelect,
  onUngroupSelectedGroups,
  onUpdate,
  readOnly,
  relativeTime,
  rootFolder,
  titleRef,
  workspaceId,
  workspaceName,
  wrapperStyle,
}: DefaultCanvasNodeProps) => (
  <div className={classes} style={wrapperStyle} onClick={handleNodeClick}>
    <CanvasNodeHeader
      fullscreenButton={fullscreenButton}
      groupDescendantCount={groupDescendantCount}
      handleClose={handleClose}
      handleFocus={handleFocus}
      handleHeaderMouseDown={handleHeaderMouseDown}
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
      onReference={onReference}
      onAddToChat={onAddToChat}
      onUngroupSelectedGroups={onUngroupSelectedGroups}
      onUpdate={onUpdate}
      readOnly={readOnly}
      relativeTime={relativeTime}
      titleRef={titleRef}
    />
    <div className="node-body" onMouseDown={handleNodeBodyMouseDown}>
      {node.type === 'file' ? (
        <FileNodeBody node={node} onUpdate={onUpdate} workspaceId={workspaceId} readOnly={readOnly} />
      ) : node.type === 'terminal' ? (
        <TerminalNodeBody node={node} getAllNodes={getAllNodes} rootFolder={rootFolder} workspaceId={workspaceId} workspaceName={workspaceName} onUpdate={onUpdate} readOnly={readOnly} />
      ) : node.type === 'frame' || node.type === 'group' ? (
        <FrameNodeBody node={node} onUpdate={onUpdate} />
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
        <IframeNodeBody node={node} workspaceId={workspaceId} onUpdate={onUpdate} isResizing={isResizing} readOnly={readOnly} />
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
