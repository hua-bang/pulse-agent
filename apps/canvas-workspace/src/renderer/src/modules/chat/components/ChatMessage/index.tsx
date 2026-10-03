import { memo, useCallback } from 'react';
import { useChatRenderTiming } from '../../runtime/useChatRenderTiming';
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
import { ChatMessageEditor } from './ChatMessageEditor';
import { ChatRecoveryConfirm } from './ChatRecoveryConfirm';

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
  /** A later user turn exists: edit/regenerate here would remove later messages. */
  hasLaterTurns?: boolean;
  /** Count the messages a recovery action at this index would remove. */
  getLaterMessageCount?: (index: number) => number;
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
  hasLaterTurns = false,
  getLaterMessageCount,
  turnStartedAt,
  onSessionJump,
}: ChatMessageProps) => {
  useChatRenderTiming(message, isStreaming);
  const {
    absoluteTime,
    assistantHtml,
    attachmentCount,
    bodyRef,
    canEdit,
    canRecoverTurn,
    canRegenerate,
    confirmRegenerateVisible,
    editValue,
    generatedImages,
    handleCancelEdit,
    handleCancelRegenerate,
    handleConfirmRegenerate,
    handleEditKeyDown,
    handleImageError,
    handleImageKeyOpen,
    handleRegenerate,
    handleSaveEdit,
    handleStartEdit,
    isEditing,
    laterMessageCount,
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
    hasLaterTurns,
    getLaterMessageCount,
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
        <ChatMessageEditor
          value={editValue}
          laterMessageCount={laterMessageCount}
          onChange={setEditValue}
          onKeyDown={handleEditKeyDown}
          onCancel={handleCancelEdit}
          onSave={() => void handleSaveEdit()}
        />
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
      <PluginChatCardForMessage message={isStreaming ? { ...message, runId: undefined } : message} />
      {confirmRegenerateVisible && (
        <ChatRecoveryConfirm
          count={laterMessageCount}
          onConfirm={handleConfirmRegenerate}
          onCancel={handleCancelRegenerate}
          onFork={onFork && message.role === 'assistant'
            ? () => {
              handleCancelRegenerate();
              void onFork(index);
            }
            : undefined}
        />
      )}
      {!isEditing && !confirmRegenerateVisible && (
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
