import type { KeyboardEvent } from 'react';
import './index.css';
import type { AgentChatMessage, CanvasNode } from '../../../../types';
import { BotAvatarIcon } from '../../../../components/icons';
import { ChatMessage } from '../ChatMessage';
import { ChatActivityStatus } from './ChatActivityStatus';
import { ChatThreadSkeleton } from './ChatThreadSkeleton';
import type { PendingClarification, ToolCallStatus } from '../../../../types';
import { buildAnchorElementId } from '../utils/anchors';
import { useI18n } from '../../../../i18n';
import { ChatClarificationCard } from './ChatClarificationCard';
import { useChatMessagesController } from './useChatMessagesController';

interface ChatMessagesProps {
  messages: AgentChatMessage[];
  loading: boolean;
  nodes?: CanvasNode[];
  workspaceId: string;
  rootFolder?: string;
  streamingTools: ToolCallStatus[];
  messageTools: Map<number, ToolCallStatus[]>;
  collapsedSections: Set<number>;
  expandedTools: Set<number>;
  pendingClarify: PendingClarification | null;
  clarifyInput: string;
  clarificationAnswering?: boolean;
  interactionDisabled?: boolean;
  clarificationError?: string | null;
  onClarifyInputChange: (value: string) => void;
  onAnswerClarification: (answerOverride?: string) => Promise<void>;
  onToggleSection: (messageIndex: number) => void;
  onToggleToolExpand: (toolId: number) => void;
  onAddImageToCanvas?: (imagePath: string, title?: string) => Promise<void> | void;
  onNodeFocus?: (nodeId: string) => void;
  onEditUserMessage?: (index: number, newContent: string) => Promise<boolean> | void;
  onRegenerate?: (index: number) => Promise<boolean> | void;
  onSessionJump?: (sessionId: string, workspaceId: string, messageIndex?: number) => void;
  pendingLabel?: string;
  /**
   * True while THIS conversation's messages are being fetched. Existing
   * content remains as a quiet transition surface; an empty thread only shows
   * its skeleton after a short delay, avoiding a one-frame flash on fast IPC.
   */
  sessionLoading?: boolean;
  /** Stable session identity used to retain this conversation's reading position. */
  conversationKey?: string;
}

const LoadingPlaceholder = ({ label, startedAt }: { label?: string; startedAt?: number }) => (
  <div className="chat-message chat-message-assistant" aria-hidden="true">
    <div className="chat-message-avatar">
      <BotAvatarIcon size={18} />
    </div>
    <div className="chat-message-body">
      {label ? (
        <div className="chat-loading">
          <div className="chat-loading-dot" />
          <div className="chat-loading-dot" />
          <div className="chat-loading-dot" />
          <span className="chat-loading-label">{label}</span>
        </div>
      ) : <ChatActivityStatus tools={[]} startedAt={startedAt} />}
    </div>
  </div>
);

const handleMessageKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const target = event.target as HTMLElement | null;
  const chip = target?.closest<HTMLElement>('.chat-mention-chip--clickable');
  if (!chip) return;
  event.preventDefault();
  chip.click();
};

export const ChatMessages = ({
  messages,
  loading,
  nodes,
  workspaceId,
  rootFolder,
  streamingTools,
  messageTools,
  collapsedSections,
  expandedTools,
  pendingClarify,
  clarifyInput,
  clarificationAnswering = false,
  interactionDisabled = false,
  clarificationError = null,
  onClarifyInputChange,
  onAnswerClarification,
  onToggleSection,
  onToggleToolExpand,
  onAddImageToCanvas,
  onNodeFocus,
  onEditUserMessage,
  onRegenerate,
  onSessionJump,
  pendingLabel,
  sessionLoading = false,
  conversationKey,
}: ChatMessagesProps) => {
  const { t } = useI18n();
  const {
    atBottom,
    containerRef,
    handleMessageClick,
    handleScroll,
    messagesEndRef,
    scrollToLatest,
    skeletonVisible,
    tabNavigationFeedback,
    turnAnnouncement,
  } = useChatMessagesController({
    messages,
    loading,
    streamingTools,
    pendingClarify,
    pendingLabel,
    sessionLoading,
    conversationKey,
    interactionDisabled,
    onSessionJump,
    onNodeFocus,
  });
  const hasStreamingAssistantMessage = loading
    && messages.length > 0
    && messages[messages.length - 1].role === 'assistant';
  const latestUserMessageIndex = messages.reduce(
    (latest, message, index) => (message.role === 'user' ? index : latest),
    -1,
  );
  return (
    <div className="chat-messages-wrap">
      {tabNavigationFeedback && (
        <div
          className="chat-tab-navigation-feedback"
          data-tone={tabNavigationFeedback.tone}
          role="status"
          aria-live="polite"
        >
          {tabNavigationFeedback.message}
        </div>
      )}
      <span
        className="chat-turn-status"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {turnAnnouncement}
      </span>
      <div
        ref={containerRef}
        className={`chat-messages${loading ? ' chat-messages--loading' : ''}${sessionLoading ? ' chat-messages--session-loading' : ''}`}
        onClick={handleMessageClick}
        onKeyDown={handleMessageKeyDown}
        onScroll={handleScroll}
        role="log"
        aria-label={t('chat.conversationMessages')}
        aria-live="polite"
        aria-relevant="additions"
        aria-busy={sessionLoading || undefined}
      >
        {skeletonVisible ? <ChatThreadSkeleton /> : <>
        {messages.map((message, index) => {
          const isStreaming = loading && message.role === 'assistant' && index === messages.length - 1;
          const tools = isStreaming ? streamingTools : (messageTools.get(index) ?? message.toolCalls);
          return (
            <ChatMessage
              key={index}
              index={index}
              message={message}
              isStreaming={isStreaming}
              loading={loading || sessionLoading || interactionDisabled}
              tools={tools}
              collapsed={collapsedSections.has(index)}
              expandedTools={expandedTools}
              nodes={nodes}
              workspaceId={workspaceId}
              rootFolder={rootFolder}
              onToggleSection={() => onToggleSection(index)}
              onToggleToolExpand={onToggleToolExpand}
              onAddImageToCanvas={onAddImageToCanvas}
              anchorId={buildAnchorElementId(workspaceId, index)}
              onEditUserMessage={onEditUserMessage}
              onRegenerate={onRegenerate}
              hideStoppedOutcome={message.turnStatus === 'stopped' && index < latestUserMessageIndex}
              turnStartedAt={isStreaming ? messages[latestUserMessageIndex]?.timestamp : undefined}
              onSessionJump={onSessionJump}
            />
          );
        })}
        {(loading || pendingLabel) && !hasStreamingAssistantMessage && (
          <LoadingPlaceholder label={pendingLabel} startedAt={messages[messages.length - 1]?.timestamp} />
        )}
        {pendingClarify && (
          <ChatClarificationCard
            pendingClarify={pendingClarify}
            clarifyInput={clarifyInput}
            answering={clarificationAnswering}
            disabled={sessionLoading}
            error={clarificationError}
            onInputChange={onClarifyInputChange}
            onAnswer={onAnswerClarification}
          />
        )}
        </>}
        <div ref={messagesEndRef} />
      </div>
      {!atBottom && messages.length > 0 && !sessionLoading && (
        <button
          type="button"
          className="chat-jump-latest"
          onClick={() => scrollToLatest('smooth')}
          aria-label={t('chat.jumpToLatest')}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
            <path d="M8 3v9.5M8 12.5L4.5 9M8 12.5L11.5 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {t('chat.jumpToLatest')}
        </button>
      )}
    </div>
  );
};
