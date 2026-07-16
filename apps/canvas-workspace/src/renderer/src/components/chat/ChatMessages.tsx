import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentChatMessage, CanvasNode } from '../../types';
import { BotAvatarIcon } from '../icons';
import { ChatMessage } from './ChatMessage';
import type { PendingClarification, ToolCallStatus } from './types';
import { buildAnchorElementId } from './utils/anchors';
import { useI18n } from '../../i18n';
import { isImeComposing } from '../../utils/ime';

/** How close (px) to the bottom still counts as "reading the tail" — within
 *  this band the view keeps following the stream; beyond it the user has
 *  scrolled up to read and auto-scroll must not yank them back. */
const PIN_THRESHOLD_PX = 80;

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
  onClarifyInputChange: (value: string) => void;
  onAnswerClarification: () => Promise<void>;
  onToggleSection: (messageIndex: number) => void;
  onToggleToolExpand: (toolId: number) => void;
  onAddImageToCanvas?: (imagePath: string, title?: string) => Promise<void> | void;
  onNodeFocus?: (nodeId: string) => void;
  onEditUserMessage?: (index: number, newContent: string) => Promise<boolean> | void;
  onRegenerate?: (index: number) => Promise<boolean> | void;
  onSessionJump?: (sessionId: string, workspaceId: string, messageIndex?: number) => void;
}

const LoadingPlaceholder = () => (
  <div className="chat-message chat-message-assistant">
    <div className="chat-message-avatar">
      <BotAvatarIcon size={18} />
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
      <BotAvatarIcon size={18} />
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
            if (event.key === 'Enter' && !event.shiftKey && !isImeComposing(event)) {
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
  rootFolder,
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
  onSessionJump,
}: ChatMessagesProps) => {
  const { t } = useI18n();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // Whether the viewport is glued to the newest message. Ref drives the
  // scroll-follow decision synchronously; state mirrors it for the
  // "jump to latest" affordance.
  const pinnedRef = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  const prevCountRef = useRef(0);
  // While a smooth programmatic scroll glides down, intermediate scroll
  // events report "not at bottom" — ignore them briefly so the jump button
  // doesn't flash mid-animation.
  const autoScrollUntilRef = useRef(0);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const pinned = distance < PIN_THRESHOLD_PX;
    if (!pinned && performance.now() < autoScrollUntilRef.current) return;
    pinnedRef.current = pinned;
    setAtBottom(pinned);
  }, []);

  const scrollToLatest = useCallback((behavior: ScrollBehavior) => {
    autoScrollUntilRef.current = behavior === 'smooth' ? performance.now() + 600 : 0;
    pinnedRef.current = true;
    setAtBottom(true);
    messagesEndRef.current?.scrollIntoView({ behavior });
  }, []);

  useEffect(() => {
    const prevCount = prevCountRef.current;
    prevCountRef.current = messages.length;
    // A message the user just sent — or a fresh session load — always snaps
    // the view to the bottom. Otherwise only follow the stream while the
    // user is already reading the tail; never yank them back up-thread.
    const lastIsUser = messages.length > 0 && messages[messages.length - 1].role === 'user';
    const userJustSent = messages.length > prevCount && lastIsUser;
    const sessionReset = messages.length < prevCount;
    if (userJustSent || sessionReset) {
      scrollToLatest(userJustSent ? 'smooth' : 'auto');
      return;
    }
    if (pinnedRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
    }
  }, [messages, pendingClarify, streamingTools, scrollToLatest]);

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

    // Session-ref chip → load session and scroll to the matched message.
    // Blocked while a turn is streaming: switching sessions mid-generation
    // would clobber the in-flight assistant message.
    const sessionChip = target.closest<HTMLElement>('[data-action="session-jump"]');
    if (sessionChip) {
      if (loading || !onSessionJump) return;
      const sid = sessionChip.dataset.sessionId;
      const wid = sessionChip.dataset.workspaceId;
      const mi = sessionChip.dataset.messageIndex;
      const parsedIndex = mi !== undefined && mi !== '' ? Number(mi) : undefined;
      if (sid && wid) {
        onSessionJump(sid, wid, Number.isInteger(parsedIndex) ? parsedIndex : undefined);
      }
      return;
    }

    // File/folder mention chip → open the referenced project path in VS Code.
    const fileChip = target.closest('[data-file-path]') as HTMLElement | null;
    const filePath = fileChip?.dataset.filePath;
    if (filePath) {
      void window.canvasWorkspace.file.openInVSCode(filePath);
      return;
    }

    // Mention chip → focus the canvas node it references.
    const chip = target.closest('.chat-mention-chip--clickable') as HTMLElement | null;
    if (!chip || !onNodeFocus) return;
    const nodeId = chip.dataset.nodeId;
    if (nodeId) {
      onNodeFocus(nodeId);
    }
  }, [loading, onNodeFocus, onSessionJump, t]);

  const hasStreamingAssistantMessage = loading
    && messages.length > 0
    && messages[messages.length - 1].role === 'assistant';

  return (
    <div className="chat-messages-wrap">
      <div
        ref={containerRef}
        className={`chat-messages${loading ? ' chat-messages--loading' : ''}`}
        onClick={handleMessageClick}
        onScroll={handleScroll}
      >
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
              rootFolder={rootFolder}
              onToggleSection={() => onToggleSection(index)}
              onToggleToolExpand={onToggleToolExpand}
              onAddImageToCanvas={onAddImageToCanvas}
              anchorId={buildAnchorElementId(workspaceId, index)}
              onEditUserMessage={onEditUserMessage}
              onRegenerate={onRegenerate}
              onSessionJump={onSessionJump}
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
      {!atBottom && messages.length > 0 && (
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
