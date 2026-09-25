import { memo, useCallback } from 'react';
import './index.css';
import { OrderedChatContent } from './OrderedChatContent';
import type { AgentChatMessage, CanvasNode, ToolCallStatus } from '../../../../types';
import { toFileUrl } from '../../../../utils/fileUrl';
import { BotAvatarIcon } from '../../../../components/icons';
import { roleColorSoft } from '../../../../utils/roleColors';
import { ChatActivityStatus } from '../ChatMessages/ChatActivityStatus';
import { ChatImageLightbox } from '../ChatImageLightbox';
import { PluginChatCardForMessage } from '../../../../../../plugins/renderer';
import { ChatTurnOutcome } from './ChatTurnMeta';
import { ChatMessageToolbar } from './ChatMessageToolbar';
import { useChatMessageController } from './useChatMessageController';
import { ChatMessageToolResults } from './ChatMessageToolResults';
import { MarkdownContent } from './MarkdownContent';

interface ChatMessageProps {
  message: AgentChatMessage;
  /** Index in the parent's `messages` array — used by edit / regenerate. */
  index: number;
  isStreaming: boolean;
  loading: boolean;
  tools?: ToolCallStatus[];
  collapsed: boolean;
  expandedTools: Set<number>;
  nodes?: CanvasNode[];
  workspaceId: string;
  rootFolder?: string;
  /** Called with this message's index, so the list can pass one stable handler. */
  onToggleSection: (index: number) => void;
  onToggleToolExpand: (toolId: number) => void;
  onAddImageToCanvas?: (imagePath: string, title?: string) => Promise<void> | void;
  /** DOM id used by ChatAnchors to scroll this message into view. */
  anchorId?: string;
  /** Replace this user message with `newContent` and re-run the turn. */
  onEditUserMessage?: (index: number, newContent: string) => Promise<boolean> | void;
  /** Re-run the user turn that produced this assistant message. */
  onRegenerate?: (index: number) => Promise<boolean> | void;
  onFork?: (index: number) => Promise<boolean> | void;
  /** Old stopped turns become transcript history once a later user turn exists. */
  hideStoppedOutcome?: boolean;
  /** Start of the current user turn, used for the overall Working timer. */
  turnStartedAt?: number;
  /** Jump to a session/message from a session_search result chip. */
  onSessionJump?: (sessionId: string, workspaceId: string, messageIndex?: number) => void;
}

const ChatMessageView = ({
  message,
  index,
  isStreaming,
  loading,
  tools,
  collapsed,
  expandedTools,
  nodes,
  workspaceId,
  rootFolder,
  onToggleSection,
  onToggleToolExpand,
  onAddImageToCanvas,
  anchorId,
  onEditUserMessage,
  onRegenerate,
  onFork,
  hideStoppedOutcome = false,
  turnStartedAt,
  onSessionJump,
}: ChatMessageProps) => {
  const {
    absoluteTime,
    assistantHtml,
    attachmentCount,
    bodyRef,
    canEdit,
    canRecoverTurn,
    canRegenerate,
    editValue,
    generatedImages,
    handleCancelEdit,
    handleEditKeyDown,
    handleImageError,
    handleImageKeyOpen,
    handleRegenerate,
    handleSaveEdit,
    handleStartEdit,
    isEditing,
    lightboxImages,
    lightboxIndex,
    liveToolDetailsOpen,
    relativeTime,
    setEditValue,
    setLightboxIndex,
    setLiveToolDetailsOpen,
    showCopyToolbar,
    speakerLabel,
    userHtml,
  } = useChatMessageController({
    message,
    index,
    isStreaming,
    loading,
    tools,
    nodes,
    rootFolder,
    onEditUserMessage,
    onRegenerate,
  });
  const showActivity = message.role === 'assistant' && isStreaming && !message.content;
  const toggleSection = useCallback(() => onToggleSection(index), [index, onToggleSection]);
  const renderTools = (groupTools: ToolCallStatus[], groupCollapsed: boolean, toggleGroup: () => void) => (
    <ChatMessageToolResults
      tools={groupTools}
      collapsed={showActivity ? false : groupCollapsed}
      expandedTools={expandedTools}
      loading={showActivity || (!message.contentBlocks && loading)}
      isStreaming={isStreaming}
      liveToolDetailsOpen={showActivity || !message.contentBlocks ? liveToolDetailsOpen : !groupCollapsed}
      onToggleSection={toggleGroup}
      onToggleToolExpand={onToggleToolExpand}
      onSessionJump={onSessionJump}
      workspaceId={workspaceId}
      messageTimestamp={message.timestamp}
      messageIndex={index}
      generatedImages={generatedImages.filter(image => groupTools.some(tool => image.key === `generated-${tool.id}`))}
      generatedImageIndices={generatedImages.flatMap((image, imageIndex) =>
        groupTools.some(tool => image.key === `generated-${tool.id}`) ? [imageIndex] : [])}
      attachmentCount={attachmentCount}
      setLightboxIndex={setLightboxIndex}
      onAddImageToCanvas={onAddImageToCanvas}
    />
  );
  return (
    <div
      className={`chat-message chat-message-${message.role}`}
      id={anchorId}
      role="article"
      aria-label={speakerLabel}
      aria-live={isStreaming ? 'off' : undefined}
    >
    {message.role === 'assistant' && (
      <div
        className={`chat-message-avatar${message.speakerRoleName ? ' chat-message-avatar--role' : ''}`}
        style={message.speakerRoleName && message.speakerRoleColor
          ? { color: message.speakerRoleColor, background: roleColorSoft(message.speakerRoleColor) }
          : undefined}
      >
        {message.speakerRoleName ? message.speakerRoleName.slice(0, 1) : <BotAvatarIcon size={20} />}
      </div>
    )}
    <div className="chat-message-body">
      {message.role === 'assistant' && message.speakerRoleName && (
        <span
          className="chat-message-speaker"
          style={message.speakerRoleColor
            ? { color: message.speakerRoleColor, background: roleColorSoft(message.speakerRoleColor) }
            : undefined}
        >
          <span className="chat-message-speaker-dot" />
          {message.speakerRoleName}
        </span>
      )}
      {message.attachments && message.attachments.length > 0 && (
        <div className="chat-message-images">
          {message.attachments.map((attachment, attachmentIndex) => (
            <figure key={attachment.id} className="chat-message-image-card">
              <img
                src={toFileUrl(attachment.path)}
                alt={attachment.fileName ?? 'image'}
                loading="lazy"
                decoding="async"
                className="chat-image-clickable"
                role="button"
                tabIndex={0}
                onClick={() => setLightboxIndex(attachmentIndex)}
                onKeyDown={(event) => handleImageKeyOpen(event, attachmentIndex)}
                onError={handleImageError}
              />
              {attachment.fileName && <figcaption>{attachment.fileName}</figcaption>}
            </figure>
          ))}
        </div>
      )}
      {showActivity && (
        <ChatActivityStatus
          tools={tools ?? []}
          startedAt={turnStartedAt}
          detailsExpanded={liveToolDetailsOpen}
          onToggleDetails={() => setLiveToolDetailsOpen(current => !current)}
        />
      )}
      {message.role === 'assistant' && !message.contentBlocks && tools && tools.length > 0 && (
        renderTools(tools, collapsed, toggleSection)
      )}
      {message.role === 'assistant' ? (
        message.contentBlocks ? (
          <OrderedChatContent
            blocks={message.contentBlocks}
            tools={tools ?? []}
            streaming={isStreaming}
            nodes={nodes}
            rootFolder={rootFolder}
            renderTools={renderTools}
          />
        ) : isStreaming ? (
          message.content ? (
            <MarkdownContent imagePreview bodyRef={bodyRef} html={assistantHtml} streaming />
          ) : null
        ) : (
          <MarkdownContent imagePreview bodyRef={bodyRef} html={assistantHtml} />
        )
      ) : isEditing ? (
        <div className="chat-message-edit">
          <textarea
            className="chat-message-edit-input"
            value={editValue}
            onChange={(event) => setEditValue(event.target.value)}
            onKeyDown={handleEditKeyDown}
            autoFocus
            rows={Math.min(8, Math.max(2, editValue.split('\n').length))}
          />
          <div className="chat-message-edit-actions">
            <span className="chat-message-edit-hint">⌘↵ to save · Esc to cancel</span>
            <button
              type="button"
              className="chat-message-toolbar-btn"
              onClick={handleCancelEdit}
            >
              Cancel
            </button>
            <button
              type="button"
              className="chat-message-toolbar-btn chat-message-toolbar-btn--primary"
              onClick={() => void handleSaveEdit()}
              disabled={!editValue.trim()}
            >
              Save &amp; resend
            </button>
          </div>
        </div>
      ) : (
        <MarkdownContent imagePreview bodyRef={bodyRef} html={userHtml} />
      )}
      {message.role === 'assistant' && !(hideStoppedOutcome && message.turnStatus === 'stopped') && (
        <ChatTurnOutcome
          status={message.turnStatus}
          errorDetails={message.errorDetails}
          failureKind={message.failureKind}
          retryable={message.retryable}
          onRetry={canRecoverTurn ? handleRegenerate : undefined}
        />
      )}
      <PluginChatCardForMessage message={message} />
      {!isEditing && (
        <ChatMessageToolbar
          content={message.content}
          timestamp={message.timestamp}
          relativeTime={relativeTime}
          absoluteTime={absoluteTime}
          isStreaming={isStreaming}
          showCopy={showCopyToolbar}
          onEdit={canEdit ? handleStartEdit : undefined}
          onRegenerate={canRegenerate ? handleRegenerate : undefined}
          onFork={onFork && message.role === 'assistant' && !loading && !isStreaming
            ? () => onFork(index) : undefined}
        />
      )}
    </div>
    {lightboxIndex !== null && lightboxImages[lightboxIndex] && (
      <ChatImageLightbox
        images={lightboxImages}
        startIndex={lightboxIndex}
        onClose={() => setLightboxIndex(null)}
      />
    )}
  </div>
  );
};

/**
 * Long threads mount every message; memoized rows keep composer keystrokes and
 * streaming deltas from re-rendering the whole history.
 */
export const ChatMessage = memo(ChatMessageView);
