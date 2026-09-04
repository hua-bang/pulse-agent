import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
} from 'react';
import type { AgentChatMessage, PendingClarification, ToolCallStatus } from '../../../../types';
import { useI18n } from '../../../../i18n';
import { isVSCodeLink } from '../utils/externalLinks';
import { localPathFromHref } from '../utils/localFileLinks';
import { tabRefFromMentionElement } from '../utils/tabMentions';
import { useChatMessagesStatus } from './useChatMessagesStatus';

const PIN_THRESHOLD_PX = 80;
const CONVERSATION_SCROLL_CACHE_LIMIT = 50;
const TAB_ACTIVATION_TIMEOUT_MS = 3000;
const TAB_ACTIVATION_SUCCESS_FEEDBACK_MS = 1600;

type DockTabActivationResult = { status: 'activated' | 'reopened' | 'stale' };

interface DockTabActivationRequestDetail {
  tabId: string;
  dockWorkspaceId?: string;
  tab?: ReturnType<typeof tabRefFromMentionElement>;
  respond: (result: DockTabActivationResult) => void;
}

const conversationScrollPositions = new Map<string, number>();

const rememberConversationScroll = (key: string, scrollTop: number): void => {
  conversationScrollPositions.delete(key);
  conversationScrollPositions.set(key, scrollTop);
  if (conversationScrollPositions.size <= CONVERSATION_SCROLL_CACHE_LIMIT) return;
  const oldestKey = conversationScrollPositions.keys().next().value;
  if (oldestKey) conversationScrollPositions.delete(oldestKey);
};

interface Options {
  messages: AgentChatMessage[];
  loading: boolean;
  streamingTools: ToolCallStatus[];
  pendingClarify: PendingClarification | null;
  pendingLabel?: string;
  sessionLoading: boolean;
  conversationKey?: string;
  interactionDisabled: boolean;
  onSessionJump?: (sessionId: string, workspaceId: string, messageIndex?: number) => void;
  onNodeFocus?: (nodeId: string) => void;
}

export const useChatMessagesController = ({
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
}: Options) => {
  const { t } = useI18n();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  const [tabNavigationFeedback, setTabNavigationFeedback] = useState<{
    message: string;
    tone: 'progress' | 'success' | 'error';
  } | null>(null);
  const tabNavigationFeedbackTimerRef = useRef<number>();
  const tabNavigationRequestRef = useRef(0);
  const prevCountRef = useRef(0);
  const prevSessionLoadingRef = useRef(sessionLoading);
  const previousConversationKeyRef = useRef(conversationKey);
  const restoredConversationKeyRef = useRef<string>();
  const skipNextFollowEffectRef = useRef(false);
  const autoScrollUntilRef = useRef(0);
  const latestTurnStatus = messages[messages.length - 1]?.turnStatus;
  const { skeletonVisible, turnAnnouncement } = useChatMessagesStatus({
    latestTurnStatus,
    loading,
    messageCount: messages.length,
    pendingLabel,
    sessionLoading,
  });

  useEffect(() => () => {
    tabNavigationRequestRef.current += 1;
    if (tabNavigationFeedbackTimerRef.current !== undefined) {
      window.clearTimeout(tabNavigationFeedbackTimerRef.current);
    }
  }, []);

  const handleScroll = useCallback(() => {
    const element = containerRef.current;
    if (!element) return;
    if (conversationKey) rememberConversationScroll(conversationKey, element.scrollTop);
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    const pinned = distance < PIN_THRESHOLD_PX;
    if (!pinned && performance.now() < autoScrollUntilRef.current) return;
    pinnedRef.current = pinned;
    setAtBottom(pinned);
  }, [conversationKey]);

  const scrollToLatest = useCallback((behavior: ScrollBehavior) => {
    const reducedMotionQuery = typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : undefined;
    const effectiveBehavior = behavior === 'smooth' && reducedMotionQuery?.matches ? 'auto' : behavior;
    autoScrollUntilRef.current = effectiveBehavior === 'smooth' ? performance.now() + 600 : 0;
    pinnedRef.current = true;
    setAtBottom(true);
    messagesEndRef.current?.scrollIntoView({ behavior: effectiveBehavior });
  }, []);

  useLayoutEffect(() => {
    const element = containerRef.current;
    const previousKey = previousConversationKeyRef.current;
    if (previousKey !== conversationKey) {
      if (previousKey && element) rememberConversationScroll(previousKey, element.scrollTop);
      previousConversationKeyRef.current = conversationKey;
      restoredConversationKeyRef.current = undefined;
      skipNextFollowEffectRef.current = true;
    }
    if (!conversationKey || sessionLoading || restoredConversationKeyRef.current === conversationKey || !element) return;

    const savedScrollTop = conversationScrollPositions.get(conversationKey);
    if (savedScrollTop === undefined) {
      scrollToLatest('auto');
    } else {
      element.scrollTop = savedScrollTop;
      const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
      const pinned = distance < PIN_THRESHOLD_PX;
      pinnedRef.current = pinned;
      setAtBottom(pinned);
    }
    restoredConversationKeyRef.current = conversationKey;
    skipNextFollowEffectRef.current = true;
  }, [conversationKey, scrollToLatest, sessionLoading]);

  useEffect(() => {
    const previousCount = prevCountRef.current;
    prevCountRef.current = messages.length;
    const sessionJustLoaded = prevSessionLoadingRef.current && !sessionLoading;
    prevSessionLoadingRef.current = sessionLoading;
    const lastIsUser = messages.length > 0 && messages[messages.length - 1].role === 'user';
    const userJustSent = messages.length > previousCount && lastIsUser;
    const sessionReset = messages.length < previousCount;
    if (skipNextFollowEffectRef.current) {
      skipNextFollowEffectRef.current = false;
      return;
    }
    if (userJustSent || sessionReset || sessionJustLoaded) {
      scrollToLatest(userJustSent ? 'smooth' : 'auto');
      return;
    }
    if (pinnedRef.current) messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [messages, pendingClarify, pendingLabel, sessionLoading, streamingTools, scrollToLatest]);

  const handleMessageClick = useCallback(async (event: MouseEvent) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;

    const copyButton = target.closest<HTMLButtonElement>('[data-action="copy-code"]');
    if (copyButton) {
      const codeElement = copyButton.closest('.chat-code-block')?.querySelector('code');
      const code = (codeElement?.textContent ?? '').replace(/\n$/, '');
      try {
        await navigator.clipboard.writeText(code);
        copyButton.dataset.state = 'copied';
        copyButton.textContent = t('chat.copied');
        window.setTimeout(() => {
          delete copyButton.dataset.state;
          copyButton.textContent = t('chat.copy');
        }, 1200);
      } catch {
        // Clipboard is optional in embedded/test environments.
      }
      return;
    }

    const link = target.closest<HTMLAnchorElement>('a[href]');
    const href = link?.getAttribute('href') ?? '';
    const localPath = localPathFromHref(href);
    if (localPath) {
      event.preventDefault();
      event.stopPropagation();
      void window.canvasWorkspace.file.openPath(localPath);
      return;
    }
    if (href && isVSCodeLink(href)) {
      event.preventDefault();
      event.stopPropagation();
      void window.canvasWorkspace.shell.openExternal(href);
      return;
    }

    const sessionChip = target.closest<HTMLElement>('[data-action="session-jump"]');
    if (sessionChip) {
      if (loading || sessionLoading || interactionDisabled || !onSessionJump) return;
      const sessionId = sessionChip.dataset.sessionId;
      const workspaceId = sessionChip.dataset.workspaceId;
      const messageIndex = sessionChip.dataset.messageIndex;
      const parsedIndex = messageIndex ? Number(messageIndex) : undefined;
      if (sessionId && workspaceId) {
        onSessionJump(sessionId, workspaceId, Number.isInteger(parsedIndex) ? parsedIndex : undefined);
      }
      return;
    }

    const tabChip = target.closest<HTMLElement>('[data-action="tab-jump"]');
    if (tabChip) {
      const tabId = tabChip.dataset.tabId;
      if (!tabId) return;
      const name = tabChip.querySelector('.chat-mention-chip-label')?.textContent?.trim() || tabId;
      const unavailableMessage = t('chat.tabNavigation.unavailable', { name });
      if (tabChip.dataset.state === 'stale') {
        setTabNavigationFeedback({ message: unavailableMessage, tone: 'error' });
        return;
      }
      if (tabNavigationFeedbackTimerRef.current !== undefined) {
        window.clearTimeout(tabNavigationFeedbackTimerRef.current);
      }
      setTabNavigationFeedback({ message: t('chat.tabNavigation.opening', { name }), tone: 'progress' });
      const request = ++tabNavigationRequestRef.current;
      let settled = false;
      const respond = (result: DockTabActivationResult) => {
        if (settled || request !== tabNavigationRequestRef.current) return;
        settled = true;
        if (tabNavigationFeedbackTimerRef.current !== undefined) {
          window.clearTimeout(tabNavigationFeedbackTimerRef.current);
        }
        if (result.status === 'activated' || result.status === 'reopened') {
          setTabNavigationFeedback({
            message: t(result.status === 'reopened' ? 'chat.tabNavigation.reopened' : 'chat.tabNavigation.opened', { name }),
            tone: 'success',
          });
          tabNavigationFeedbackTimerRef.current = window.setTimeout(() => setTabNavigationFeedback(null), TAB_ACTIVATION_SUCCESS_FEEDBACK_MS);
          return;
        }
        tabChip.dataset.state = 'stale';
        tabChip.classList.add('chat-mention-chip--stale');
        tabChip.setAttribute('aria-disabled', 'true');
        tabChip.title = unavailableMessage;
        setTabNavigationFeedback({ message: unavailableMessage, tone: 'error' });
      };
      tabNavigationFeedbackTimerRef.current = window.setTimeout(
        () => respond({ status: 'stale' }),
        TAB_ACTIVATION_TIMEOUT_MS,
      );
      const detail: DockTabActivationRequestDetail = {
        tabId,
        dockWorkspaceId: tabChip.dataset.dockWorkspaceId,
        tab: tabRefFromMentionElement(tabChip),
        respond,
      };
      window.dispatchEvent(new CustomEvent('canvas:activate-dock-tab', { detail }));
      return;
    }

    const fileChip = target.closest<HTMLElement>('[data-file-path]');
    const filePath = fileChip?.dataset.filePath;
    if (filePath) {
      void window.canvasWorkspace.file.openInVSCode(filePath);
      return;
    }

    const chip = target.closest<HTMLElement>('.chat-mention-chip--clickable');
    const nodeId = chip?.dataset.nodeId;
    if (nodeId) onNodeFocus?.(nodeId);
  }, [interactionDisabled, loading, onNodeFocus, onSessionJump, sessionLoading, t]);

  return {
    atBottom,
    containerRef,
    handleMessageClick,
    handleScroll,
    messagesEndRef,
    scrollToLatest,
    skeletonVisible,
    tabNavigationFeedback,
    turnAnnouncement,
  };
};
