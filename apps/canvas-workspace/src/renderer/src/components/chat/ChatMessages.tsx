import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import type { AgentChatMessage, CanvasNode } from '../../types';
import { BotAvatarIcon } from '../icons';
import { ChatMessage } from './ChatMessage';
import { ChatThreadSkeleton } from './ChatThreadSkeleton';
import type { PendingClarification, ToolCallStatus } from './types';
import { buildAnchorElementId } from './utils/anchors';
import { useI18n } from '../../i18n';
import { isVSCodeLink } from './utils/externalLinks';
import { ChatClarificationCard } from './ChatClarificationCard';
import { useChatMessagesStatus } from './hooks/useChatMessagesStatus';

/** How close (px) to the bottom still counts as "reading the tail" — within
 *  this band the view keeps following the stream; beyond it the user has
 *  scrolled up to read and auto-scroll must not yank them back. */
const PIN_THRESHOLD_PX = 80;
const CONVERSATION_SCROLL_CACHE_LIMIT = 50;

// Session switches remount the transcript content, not the scroll container.
// Keep a small LRU-like cache so returning to a conversation restores the
// reader's place without retaining an unbounded session history.
const conversationScrollPositions = new Map<string, number>();

const rememberConversationScroll = (key: string, scrollTop: number): void => {
  conversationScrollPositions.delete(key);
  conversationScrollPositions.set(key, scrollTop);
  if (conversationScrollPositions.size <= CONVERSATION_SCROLL_CACHE_LIMIT) return;
  const oldestKey = conversationScrollPositions.keys().next().value;
  if (oldestKey) conversationScrollPositions.delete(oldestKey);
};

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

const LoadingPlaceholder = ({ label }: { label?: string }) => (
  <div className="chat-message chat-message-assistant" aria-hidden="true">
    <div className="chat-message-avatar">
      <BotAvatarIcon size={18} />
    </div>
    <div className="chat-message-body">
      <div className="chat-loading">
        <div className="chat-loading-dot" />
        <div className="chat-loading-dot" />
        <div className="chat-loading-dot" />
        {label && <span className="chat-loading-label">{label}</span>}
      </div>
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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // Whether the viewport is glued to the newest message. Ref drives the
  // scroll-follow decision synchronously; state mirrors it for the
  // "jump to latest" affordance.
  const pinnedRef = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  const prevCountRef = useRef(0);
  const prevSessionLoadingRef = useRef(sessionLoading);
  const previousConversationKeyRef = useRef(conversationKey);
  const restoredConversationKeyRef = useRef<string>();
  const skipNextFollowEffectRef = useRef(false);
  // While a smooth programmatic scroll glides down, intermediate scroll
  // events report "not at bottom" — ignore them briefly so the jump button
  // doesn't flash mid-animation.
  const autoScrollUntilRef = useRef(0);
  const latestTurnStatus = messages[messages.length - 1]?.turnStatus;
  const { skeletonVisible, turnAnnouncement } = useChatMessagesStatus({
    latestTurnStatus,
    loading,
    messageCount: messages.length,
    pendingLabel,
    sessionLoading,
  });

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (conversationKey) rememberConversationScroll(conversationKey, el.scrollTop);
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const pinned = distance < PIN_THRESHOLD_PX;
    if (!pinned && performance.now() < autoScrollUntilRef.current) return;
    pinnedRef.current = pinned;
    setAtBottom(pinned);
  }, [conversationKey]);

  const scrollToLatest = useCallback((behavior: ScrollBehavior) => {
    const reducedMotionQuery = typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : undefined;
    const reducedMotion = reducedMotionQuery?.matches ?? false;
    const effectiveBehavior = behavior === 'smooth' && reducedMotion ? 'auto' : behavior;
    autoScrollUntilRef.current = effectiveBehavior === 'smooth' ? performance.now() + 600 : 0;
    pinnedRef.current = true;
    setAtBottom(true);
    messagesEndRef.current?.scrollIntoView({ behavior: effectiveBehavior });
  }, []);

  useLayoutEffect(() => {
    const el = containerRef.current;
    const previousKey = previousConversationKeyRef.current;
    if (previousKey !== conversationKey) {
      if (previousKey && el) rememberConversationScroll(previousKey, el.scrollTop);
      previousConversationKeyRef.current = conversationKey;
      restoredConversationKeyRef.current = undefined;
      skipNextFollowEffectRef.current = true;
    }
    if (
      !conversationKey
      || sessionLoading
      || restoredConversationKeyRef.current === conversationKey
      || !el
    ) {
      return;
    }

    const savedScrollTop = conversationScrollPositions.get(conversationKey);
    if (savedScrollTop === undefined) {
      scrollToLatest('auto');
    } else {
      el.scrollTop = savedScrollTop;
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      const pinned = distance < PIN_THRESHOLD_PX;
      pinnedRef.current = pinned;
      setAtBottom(pinned);
    }
    restoredConversationKeyRef.current = conversationKey;
    skipNextFollowEffectRef.current = true;
  }, [conversationKey, scrollToLatest, sessionLoading]);

  useEffect(() => {
    const prevCount = prevCountRef.current;
    prevCountRef.current = messages.length;
    const sessionJustLoaded = prevSessionLoadingRef.current && !sessionLoading;
    prevSessionLoadingRef.current = sessionLoading;
    // A message the user just sent — or a fresh session load — always snaps
    // the view to the bottom. Otherwise only follow the stream while the
    // user is already reading the tail; never yank them back up-thread.
    const lastIsUser = messages.length > 0 && messages[messages.length - 1].role === 'user';
    const userJustSent = messages.length > prevCount && lastIsUser;
    const sessionReset = messages.length < prevCount;
    if (skipNextFollowEffectRef.current) {
      skipNextFollowEffectRef.current = false;
      return;
    }
    if (userJustSent || sessionReset || sessionJustLoaded) {
      scrollToLatest(userJustSent ? 'smooth' : 'auto');
      return;
    }
    if (pinnedRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
    }
  }, [messages, pendingClarify, pendingLabel, sessionLoading, streamingTools, scrollToLatest]);

  const handleMessageClick = useCallback(async (event: MouseEvent) => {
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

    // VS Code protocol links from markdown should launch the editor through
    // main-process shell.openExternal; letting target=_blank handle them asks
    // Electron to create a BrowserWindow for a custom scheme.
    const link = target.closest<HTMLAnchorElement>('a[href]');
    const href = link?.getAttribute('href') ?? '';
    if (href && isVSCodeLink(href)) {
      event.preventDefault();
      event.stopPropagation();
      void window.canvasWorkspace.shell.openExternal(href);
      return;
    }

    // Session-ref chip → load session and scroll to the matched message.
    // Blocked while a turn is streaming: switching sessions mid-generation
    // would clobber the in-flight assistant message.
    const sessionChip = target.closest<HTMLElement>('[data-action="session-jump"]');
    if (sessionChip) {
      if (loading || sessionLoading || interactionDisabled || !onSessionJump) return;
      const sid = sessionChip.dataset.sessionId;
      const wid = sessionChip.dataset.workspaceId;
      const mi = sessionChip.dataset.messageIndex;
      const parsedIndex = mi !== undefined && mi !== '' ? Number(mi) : undefined;
      if (sid && wid) {
        onSessionJump(sid, wid, Number.isInteger(parsedIndex) ? parsedIndex : undefined);
      }
      return;
    }

    // Tab mention chip → activate the referenced right-dock tab. Broadcast so
    // the dock (which owns tab state) can switch to it; harmless where no dock
    // is mounted (full-screen chat).
    const tabChip = target.closest<HTMLElement>('[data-action="tab-jump"]');
    if (tabChip) {
      const tabId = tabChip.dataset.tabId;
      if (tabId) window.dispatchEvent(new CustomEvent('canvas:activate-dock-tab', { detail: { tabId } }));
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
  }, [interactionDisabled, loading, onNodeFocus, onSessionJump, sessionLoading, t]);

  const hasStreamingAssistantMessage = loading
    && messages.length > 0
    && messages[messages.length - 1].role === 'assistant';

  return (
    <div className="chat-messages-wrap">
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
        className={`chat-messages${loading ? ' chat-messages--loading' : ''}`}
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
              onSessionJump={onSessionJump}
            />
          );
        })}
        {(loading || pendingLabel) && !hasStreamingAssistantMessage && (
          <LoadingPlaceholder label={pendingLabel} />
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
