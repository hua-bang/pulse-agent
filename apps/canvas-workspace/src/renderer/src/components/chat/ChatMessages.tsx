import { useCallback, useEffect, useRef } from 'react';
import type { AgentChatMessage, CanvasNode } from '../../types';
import { AvatarIcon } from '../icons';
import { ChatMessage } from './ChatMessage';
import type { PendingClarification, ToolCallStatus } from './types';
import { buildAnchorElementId } from './utils/anchors';
import { useI18n } from '../../i18n';

interface ChatMessagesProps {
  messages: AgentChatMessage[];
  loading: boolean;
  nodes?: CanvasNode[];
  workspaceId: string;
  streamingTools: ToolCallStatus[];
  messageTools: Map<number, ToolCallStatus[]>;
  collapsedSections: Set<number>;
  expandedTools: Set<number>;
  pendingClarify: PendingClarification | null;
  clarifyInput: string;
  onClarifyInputChange: (value: string) => void;
  onAnswerClarification: () => Promise<void>;
  onToggleSection: (messageIndex: number) => void;
  onToggleToolExpand: (toolId: number) => void;
  onAddImageToCanvas?: (imagePath: string, title?: string) => Promise<void> | void;
  onNodeFocus?: (nodeId: string) => void;
  onEditUserMessage?: (index: number, newContent: string) => Promise<boolean> | void;
  onRegenerate?: (index: number) => Promise<boolean> | void;
}

const LoadingPlaceholder = () => (
  <div className="chat-message chat-message-assistant">
    <div className="chat-message-avatar">
      <AvatarIcon size={14} />
    </div>
    <div className="chat-message-body">
      <div className="chat-loading">
        <div className="chat-loading-dot" />
        <div className="chat-loading-dot" />
        <div className="chat-loading-dot" />
      </div>
    </div>
  </div>
);

const ClarificationCard = ({
  pendingClarify,
  clarifyInput,
  onClarifyInputChange,
  onAnswerClarification,
}: {
  pendingClarify: PendingClarification;
  clarifyInput: string;
  onClarifyInputChange: (value: string) => void;
  onAnswerClarification: () => Promise<void>;
}) => (
  <div className="chat-message chat-message-assistant">
    <div className="chat-message-avatar">
      <AvatarIcon size={14} />
    </div>
    <div className="chat-message-body">
      <div className="chat-clarify-card">
        <ClarificationContent
          pendingClarify={pendingClarify}
          clarifyInput={clarifyInput}
          onClarifyInputChange={onClarifyInputChange}
          onAnswerClarification={onAnswerClarification}
        />
      </div>
    </div>
  </div>
);

const ClarificationContent = ({
  pendingClarify,
  clarifyInput,
  onClarifyInputChange,
  onAnswerClarification,
}: {
  pendingClarify: PendingClarification;
  clarifyInput: string;
  onClarifyInputChange: (value: string) => void;
  onAnswerClarification: () => Promise<void>;
}) => {
  const { t } = useI18n();

  return (
    <>
      <div className="chat-clarify-label">{t('chat.needsClarification')}</div>
      <div className="chat-clarify-question">{pendingClarify.question}</div>
      {pendingClarify.context && (
        <div className="chat-clarify-context">{pendingClarify.context}</div>
      )}
      <div className="chat-clarify-form">
        <input
          type="text"
          className="chat-clarify-input"
          value={clarifyInput}
          onChange={(event) => onClarifyInputChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void onAnswerClarification();
            }
          }}
          placeholder={t('chat.typeAnswer')}
          autoFocus
        />
        <button
          className="chat-clarify-submit"
          onClick={() => void onAnswerClarification()}
          disabled={!clarifyInput.trim()}
        >
          {t('chat.reply')}
        </button>
      </div>
    </>
  );
};

export const ChatMessages = ({
  messages,
  loading,
  nodes,
  workspaceId,
  streamingTools,
  messageTools,
  collapsedSections,
  expandedTools,
  pendingClarify,
  clarifyInput,
  onClarifyInputChange,
  onAnswerClarification,
  onToggleSection,
  onToggleToolExpand,
  onAddImageToCanvas,
  onNodeFocus,
  onEditUserMessage,
  onRegenerate,
}: ChatMessagesProps) => {
  const { t } = useI18n();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, pendingClarify, streamingTools]);

  const handleMessageClick = useCallback(async (event: React.MouseEvent) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;

    // Copy-code button rendered by the markdown fence renderer.
    const copyBtn = target.closest<HTMLButtonElement>('[data-action="copy-code"]');
    if (copyBtn) {
      const codeEl = copyBtn.closest('.chat-code-block')?.querySelector('code');
      const code = (codeEl?.textContent ?? '').replace(/\n$/, '');
      try {
        await navigator.clipboard.writeText(code);
        copyBtn.dataset.state = 'copied';
        copyBtn.textContent = t('chat.copied');
        window.setTimeout(() => {
          delete copyBtn.dataset.state;
          copyBtn.textContent = t('chat.copy');
        }, 1200);
      } catch {
        /* clipboard unavailable — ignore */
      }
      return;
    }

    // Mention chip → focus the canvas node it references.
    const chip = target.closest('.chat-mention-chip--clickable') as HTMLElement | null;
    if (!chip || !onNodeFocus) return;
    const nodeId = chip.dataset.nodeId;
    if (nodeId) {
      onNodeFocus(nodeId);
    }
  }, [onNodeFocus, t]);

  const hasStreamingAssistantMessage = loading
    && messages.length > 0
    && messages[messages.length - 1].role === 'assistant';

  return (
    <div className="chat-messages" onClick={handleMessageClick}>
      {messages.map((message, index) => {
        const isStreaming = loading && message.role === 'assistant' && index === messages.length - 1;
        const tools = isStreaming ? streamingTools : (messageTools.get(index) ?? message.toolCalls);
        return (
          <ChatMessage
            key={index}
            index={index}
            message={message}
            isStreaming={isStreaming}
            loading={loading}
            tools={tools}
            collapsed={collapsedSections.has(index)}
            expandedTools={expandedTools}
            nodes={nodes}
            workspaceId={workspaceId}
            onToggleSection={() => onToggleSection(index)}
            onToggleToolExpand={onToggleToolExpand}
            onAddImageToCanvas={onAddImageToCanvas}
            anchorId={buildAnchorElementId(workspaceId, index)}
            onEditUserMessage={onEditUserMessage}
            onRegenerate={onRegenerate}
          />
        );
      })}
      {loading && !hasStreamingAssistantMessage && <LoadingPlaceholder />}
      {pendingClarify && (
        <ClarificationCard
          pendingClarify={pendingClarify}
          clarifyInput={clarifyInput}
          onClarifyInputChange={onClarifyInputChange}
          onAnswerClarification={onAnswerClarification}
        />
      )}
      <div ref={messagesEndRef} />
    </div>
  );
};
