import type { FocusEvent, KeyboardEvent, MouseEvent, ReactNode, RefObject } from 'react';
import type { AgentNodeData, CanvasNode, IframeNodeData } from '../../types';
import { FrameChildrenToggle, FrameColorPicker } from '../FrameNodeBody';
import { TextColorPicker } from '../TextNodeBody';
import {
  AddToChatButton,
  CloseButton,
  FocusButton,
  PluginDevToolsButton,
  PluginReloadButton,
  ReferenceButton,
} from './NodeButtons';
import { NodeTypeBadge } from './NodeTypeBadge';

interface CanvasNodeHeaderProps {
  fullscreenButton: ReactNode;
  containerDescendantCount: number;
  handleClose: (e: MouseEvent) => void;
  handleFocus: (e: MouseEvent) => void;
  handleHeaderMouseDown: (e: MouseEvent) => void;
  handlePluginDevTools: (e: MouseEvent) => void;
  handlePluginReload: (e: MouseEvent) => void;
  handleReference: (e: MouseEvent) => void;
  handleAddToChat: (e: MouseEvent) => void;
  handleTitleBlur: (e: FocusEvent<HTMLSpanElement>) => void;
  handleTitleDoubleClick: (e: MouseEvent) => void;
  handleTitleKeyDown: (e: KeyboardEvent<HTMLSpanElement>) => void;
  handleUngroup: (e: MouseEvent) => void;
  isEditingTitle: boolean;
  isFullscreen: boolean;
  isSelected: boolean;
  node: CanvasNode;
  onReference?: (nodeId: string) => void;
  onAddToChat?: (nodeId: string) => void;
  onUngroupSelectedGroups?: () => void;
  onUpdate: (id: string, patch: Partial<CanvasNode>) => void;
  readOnly: boolean;
  relativeTime: string | null;
  titleRef: RefObject<HTMLSpanElement>;
}

export const CanvasNodeHeader = ({
  fullscreenButton,
  containerDescendantCount,
  handleClose,
  handleFocus,
  handleHeaderMouseDown,
  handlePluginDevTools,
  handlePluginReload,
  handleReference,
  handleAddToChat,
  handleTitleBlur,
  handleTitleDoubleClick,
  handleTitleKeyDown,
  handleUngroup,
  isEditingTitle,
  isFullscreen,
  isSelected,
  node,
  onReference,
  onAddToChat,
  onUngroupSelectedGroups,
  onUpdate,
  readOnly,
  relativeTime,
  titleRef,
}: CanvasNodeHeaderProps) => {
  const agentTeamRole = node.type === 'agent'
    ? (node.data as AgentNodeData).agentTeamRole
    : undefined;
  const faviconUrl = node.type === 'iframe'
    ? (node.data as IframeNodeData).faviconUrl
    : undefined;

  return (
    <div
      className="node-header"
      onMouseDown={isFullscreen ? undefined : handleHeaderMouseDown}
    >
      <NodeTypeBadge type={node.type} />
      {faviconUrl ? (
        <img
          className="node-favicon"
          src={faviconUrl}
          alt=""
          aria-hidden="true"
          onError={(event) => {
            event.currentTarget.style.display = 'none';
          }}
        />
      ) : null}
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
      {node.type === 'group' && (
        <span className="group-count-label">
          {containerDescendantCount}
        </span>
      )}
      {agentTeamRole && (
        <span className={`node-agent-team-role node-agent-team-role--${agentTeamRole}`}>
          {agentTeamRole === 'lead' ? 'Lead' : 'Teammate'}
        </span>
      )}
      {node.type === 'group' && isSelected && !readOnly && onUngroupSelectedGroups && (
        <button
          className="group-ungroup-button"
          type="button"
          onClick={handleUngroup}
          title="Ungroup selected group (⌘⇧G)"
          aria-label="Ungroup selected group"
        >
          Ungroup
        </button>
      )}
      {node.type === 'frame' && !readOnly && (
        <FrameChildrenToggle
          node={node}
          descendantCount={containerDescendantCount}
          onUpdate={onUpdate}
        />
      )}
      {relativeTime && (
        <span className="node-time-label" title={new Date(node.updatedAt!).toLocaleString()}>
          {relativeTime}
        </span>
      )}
      {node.type === 'frame' && !readOnly && (
        <FrameColorPicker node={node} onUpdate={onUpdate} />
      )}
      {node.type === 'text' && !readOnly && (
        <TextColorPicker node={node} onUpdate={onUpdate} />
      )}
      <div className="node-header__actions">
        {!readOnly && onReference ? (
          <ReferenceButton nodeTitle={node.title} onClick={handleReference} />
        ) : null}
        {!readOnly && onAddToChat ? (
          <AddToChatButton onClick={handleAddToChat} />
        ) : null}
        {node.type === 'plugin' ? (
          <>
            <PluginReloadButton onClick={handlePluginReload} />
            <PluginDevToolsButton onClick={handlePluginDevTools} />
          </>
        ) : null}
        {fullscreenButton}
        <FocusButton onClick={handleFocus} />
        {readOnly ? null : <CloseButton onClick={handleClose} />}
      </div>
    </div>
  );
};
