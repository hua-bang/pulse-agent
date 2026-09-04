import './index.css';
import type { AgentChatMessage, CanvasNode } from '../../../../types';
import { toFileUrl } from '../../../../utils/fileUrl';
import { BotAvatarIcon, PencilIcon, RefreshIcon } from '../../../../components/icons';
import type { ToolCallStatus } from '../../../../types';
import { roleColorSoft } from '../../../../utils/roleColors';
import { ChatActivityStatus } from '../ChatMessages/ChatActivityStatus';
import { ChatImageLightbox } from '../ChatImageLightbox';
import { PluginChatCardForMessage } from '../../../../../../plugins/renderer';
import { ChatTurnOutcome } from './ChatTurnMeta';
import { CopyMessageButton } from './ChatMessageActions';
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
  onToggleSection: () => void;
  onToggleToolExpand: (toolId: number) => void;
  onAddImageToCanvas?: (imagePath: string, title?: string) => Promise<void> | void;
  /** DOM id used by ChatAnchors to scroll this message into view. */
  anchorId?: string;
  /** Replace this user message with `newContent` and re-run the turn. */
  onEditUserMessage?: (index: number, newContent: string) => Promise<boolean> | void;
  /** Re-run the user turn that produced this assistant message. */
  onRegenerate?: (index: number) => Promise<boolean> | void;
  /** Old stopped turns become transcript history once a later user turn exists. */
  hideStoppedOutcome?: boolean;
  /** Start of the current user turn, used for the overall Working timer. */
  turnStartedAt?: number;
  /** Jump to a session/message from a session_search result chip. */
  onSessionJump?: (sessionId: string, workspaceId: string, messageIndex?: number) => void;
}

export const ChatMessage = ({
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
      {message.role === 'assistant' && isStreaming && !message.content && (
        <ChatActivityStatus
          tools={tools ?? []}
          startedAt={turnStartedAt}
          detailsExpanded={liveToolDetailsOpen}
          onToggleDetails={() => setLiveToolDetailsOpen(current => !current)}
        />
      )}
      {message.role === 'assistant' && tools && tools.length > 0 && (
        <ChatMessageToolResults
          tools={tools}
          collapsed={collapsed}
          expandedTools={expandedTools}
          loading={loading}
          isStreaming={isStreaming}
          liveToolDetailsOpen={liveToolDetailsOpen}
          onToggleSection={onToggleSection}
          onToggleToolExpand={onToggleToolExpand}
          onSessionJump={onSessionJump}
          workspaceId={workspaceId}
          messageTimestamp={message.timestamp}
          messageIndex={index}
          generatedImages={generatedImages}
          attachmentCount={attachmentCount}
          setLightboxIndex={setLightboxIndex}
          onAddImageToCanvas={onAddImageToCanvas}
        />
      )}
      {message.role === 'assistant' ? (
        isStreaming ? (
          message.content ? (
            <MarkdownContent bodyRef={bodyRef} html={assistantHtml} streaming />
          ) : null
        ) : (
          <MarkdownContent bodyRef={bodyRef} html={assistantHtml} />
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
        <MarkdownContent bodyRef={bodyRef} html={userHtml} />
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
      {!isEditing && (showCopyToolbar || canEdit || canRegenerate || (!isStreaming && relativeTime)) && (
        <div className="chat-message-toolbar">
          {!isStreaming && relativeTime && (
            <time
              className="chat-message-timestamp"
              dateTime={new Date(message.timestamp).toISOString()}
              title={absoluteTime}
            >
              {relativeTime}
            </time>
          )}
          {canEdit && (
            <button
              type="button"
              className="chat-message-toolbar-btn chat-message-toolbar-btn--icon"
              title="Edit & resend"
              aria-label="Edit and resend"
              onClick={handleStartEdit}
            >
              <PencilIcon size={12} />
            </button>
          )}
          {canRegenerate && (
            <button
              type="button"
              className="chat-message-toolbar-btn chat-message-toolbar-btn--icon"
              title="Regenerate response"
              aria-label="Regenerate response"
              onClick={handleRegenerate}
            >
              <RefreshIcon size={12} />
            </button>
          )}
          {showCopyToolbar && <CopyMessageButton content={message.content} />}
        </div>
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
