import { useEffect, useState } from 'react';
import type { FocusEvent, KeyboardEvent, MouseEvent, ReactNode, RefObject } from 'react';
import type { AgentNodeData, CanvasNode, IframeNodeData } from '../../types';
import { FrameChildrenToggle, FrameColorPicker } from '../FrameNodeBody/FrameHeaderControls';
import { TextColorPicker } from '../TextNodeBody/TextColorPicker';
import {
  AddToChatButton,
  CloseButton,
  FocusButton,
  OpenDetailButton,
  PluginSelectElementButton,
  ReferenceButton,
} from './NodeButtons';
import { NodeTypeBadge } from './NodeTypeBadge';
import { isReferenceableNode } from '../../utils/referenceNodes';

interface CanvasNodeHeaderProps {
  fullscreenButton: ReactNode;
  containerDescendantCount: number;
  handleClose: (e: MouseEvent) => void;
  handleFocus: (e: MouseEvent) => void;
  handleHeaderMouseDown: (e: MouseEvent) => void;
  handlePluginSelectElement: (e: MouseEvent) => void;
  handleOpenDetail: (e: MouseEvent) => void;
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
  pluginElementPickerActive: boolean;
  onReference?: (nodeId: string) => void;
  onAddToChat?: (nodeId: string) => void;
  onUngroupSelectedGroups?: () => void;
  onUpdate: (id: string, patch: Partial<CanvasNode>) => void;
  readOnly: boolean;
  relativeTime: string | null;
  titleRef: RefObject<HTMLSpanElement>;
}

/**
 * Leading glyph in a node header. Web (iframe) nodes show their page favicon —
 * it identifies the site better than the generic globe badge and avoids drawing
 * two near-identical "web" glyphs stacked over the address bar. Falls back to
 * the type badge when there's no favicon or it fails to load.
 */
const NodeLeadingGlyph = ({ node, faviconUrl }: { node: CanvasNode; faviconUrl?: string }) => {
  const [faviconFailed, setFaviconFailed] = useState(false);
  // A fresh favicon (e.g. after navigating the embed) gets another chance.
  useEffect(() => setFaviconFailed(false), [faviconUrl]);

  if (node.type === 'iframe' && faviconUrl && !faviconFailed) {
    return (
      <img
        className="node-favicon"
        src={faviconUrl}
        alt=""
        aria-hidden="true"
        onError={() => setFaviconFailed(true)}
      />
    );
  }
  return <NodeTypeBadge type={node.type} />;
};

export const CanvasNodeHeader = ({
  fullscreenButton,
  containerDescendantCount,
  handleClose,
  handleFocus,
  handleHeaderMouseDown,
  handlePluginSelectElement,
  handleOpenDetail,
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
  pluginElementPickerActive,
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
      <NodeLeadingGlyph node={node} faviconUrl={faviconUrl} />
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
        {node.type === 'file' ? (
          <OpenDetailButton onClick={handleOpenDetail} />
        ) : null}
        {!readOnly && onReference && isReferenceableNode(node) ? (
          <ReferenceButton nodeTitle={node.title} onClick={handleReference} />
        ) : null}
        {!readOnly && onAddToChat ? (
          <AddToChatButton onClick={handleAddToChat} />
        ) : null}
        {node.type === 'plugin' ? (
          <PluginSelectElementButton
            active={pluginElementPickerActive}
            onClick={handlePluginSelectElement}
          />
        ) : null}
        {fullscreenButton}
        <FocusButton onClick={handleFocus} />
        {readOnly ? null : <CloseButton onClick={handleClose} />}
      </div>
    </div>
  );
};
