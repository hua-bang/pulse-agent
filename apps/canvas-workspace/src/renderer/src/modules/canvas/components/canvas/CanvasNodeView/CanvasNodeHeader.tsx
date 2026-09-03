import { useEffect, useState } from 'react';
import type {
  ClipboardEvent,
  FocusEvent,
  KeyboardEvent,
  MouseEvent,
  ReactNode,
  RefObject,
} from 'react';
import type { AgentNodeData, CanvasNode, IframeNodeData } from '../../../../../types';
import { useI18n } from '../../../../../i18n';
import { FrameChildrenToggle, FrameColorPicker } from '../../node-bodies/FrameNodeBody/FrameHeaderControls';
import { TextColorPicker } from '../../node-bodies/TextNodeBody/TextColorPicker';
import {
  AddToCanvasButton,
  AddToChatButton,
  CloseButton,
  FocusButton,
  OpenDetailButton,
  OpenTabButton,
  PluginSelectElementButton,
} from './NodeButtons';
import { NodeTypeBadge } from './NodeTypeBadge';
import { isKnowledgeNodeType } from '../../../../../shared/knowledgeNodes';
import { isReferenceableNode } from '../../../../../utils/referenceNodes';
import type { ChatDeliveryReceipt } from '../../../../chat';

interface CanvasNodeHeaderProps {
  fullscreenButton: ReactNode;
  focusAction?: {
    ariaLabel: string;
    title: string;
  };
  containerDescendantCount: number;
  handleClose: (e: MouseEvent) => void;
  handleFocus: (e: MouseEvent) => void;
  handleHeaderMouseDown: (e: MouseEvent) => void;
  handlePluginSelectElement: (e: MouseEvent) => void;
  handleOpenDetail: (e: MouseEvent) => void;
  handleOpenTab: (e: MouseEvent) => void;
  handleAddToChat: (e: MouseEvent) => void;
  handleAddToCanvas: (e: MouseEvent) => void;
  handleTitleBlur: (e: FocusEvent<HTMLSpanElement>) => void;
  handleTitleDoubleClick: (e: MouseEvent) => void;
  handleTitleKeyDown: (e: KeyboardEvent<HTMLSpanElement>) => void;
  handleTitlePaste: (e: ClipboardEvent<HTMLSpanElement>) => void;
  handleUngroup: (e: MouseEvent) => void;
  isEditingTitle: boolean;
  isFullscreen: boolean;
  isSelected: boolean;
  node: CanvasNode;
  pluginElementPickerActive: boolean;
  canOpenTab: boolean;
  onAddToChat?: (nodeId: string) => void | Promise<ChatDeliveryReceipt>;
  onAddToCanvas?: (nodeId: string) => void;
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
  focusAction,
  containerDescendantCount,
  handleClose,
  handleFocus,
  handleHeaderMouseDown,
  handlePluginSelectElement,
  handleOpenDetail,
  handleOpenTab,
  handleAddToChat,
  handleAddToCanvas,
  handleTitleBlur,
  handleTitleDoubleClick,
  handleTitleKeyDown,
  handleTitlePaste,
  handleUngroup,
  isEditingTitle,
  isFullscreen,
  isSelected,
  node,
  pluginElementPickerActive,
  canOpenTab,
  onAddToChat,
  onAddToCanvas,
  onUngroupSelectedGroups,
  onUpdate,
  readOnly,
  relativeTime,
  titleRef,
}: CanvasNodeHeaderProps) => {
  const { t } = useI18n();
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
        role={isEditingTitle ? 'textbox' : readOnly ? undefined : 'button'}
        tabIndex={readOnly ? undefined : 0}
        aria-label={readOnly
          ? undefined
          : t('workspaceNodes.editTitleNamed', { title: node.title })}
        aria-keyshortcuts={!isEditingTitle && !readOnly ? 'Enter F2' : undefined}
        aria-multiline={isEditingTitle ? false : undefined}
        title={isEditingTitle ? undefined : node.title}
        suppressContentEditableWarning
        spellCheck={false}
        onBlur={handleTitleBlur}
        onKeyDown={readOnly ? undefined : handleTitleKeyDown}
        onPaste={isEditingTitle ? handleTitlePaste : undefined}
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
      {node.type === 'frame' && (
        <FrameChildrenToggle
          node={node}
          descendantCount={containerDescendantCount}
          onUpdate={onUpdate}
          readOnly={readOnly}
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
        {canOpenTab && isKnowledgeNodeType(node.type) ? (
          <OpenTabButton
            ariaLabel={t('workspaceNodes.openNodeTab', { title: node.title })}
            nodeTitle={node.title}
            onClick={handleOpenTab}
          />
        ) : null}
        {onAddToChat ? (
          <AddToChatButton onClick={handleAddToChat} />
        ) : null}
        {onAddToCanvas && isReferenceableNode(node) ? (
          <AddToCanvasButton onClick={handleAddToCanvas} />
        ) : null}
        {node.type === 'plugin' ? (
          <PluginSelectElementButton
            active={pluginElementPickerActive}
            onClick={handlePluginSelectElement}
          />
        ) : null}
        {fullscreenButton}
        <FocusButton
          ariaLabel={focusAction?.ariaLabel ?? t('workspaceNodes.focusNode', { title: node.title })}
          onClick={handleFocus}
          title={focusAction?.title ?? t('workspaceNodes.focusNode', { title: node.title })}
        />
        {readOnly ? null : (
          <CloseButton
            ariaLabel={t('workspaceNodes.removeNode', { title: node.title })}
            onClick={handleClose}
            title={t('workspaceNodes.removeNode', { title: node.title })}
          />
        )}
      </div>
    </div>
  );
};
