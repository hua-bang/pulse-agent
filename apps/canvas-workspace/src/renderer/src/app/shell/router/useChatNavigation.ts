import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type {
  ChatTarget,
  ChatTargetBroker,
} from '../../../modules/chat';
import { isImeComposing } from '../../../utils/ime';

interface UseChatNavigationOptions {
  activeView: string;
  location: string;
  setLocation: (path: string) => void;
  activeTarget: ChatTarget | null;
  broker: ChatTargetBroker;
  openDockChat: () => void;
  isOverlayOpen: boolean;
  openShortcuts: () => void;
  /** Whether a workspace still exists, so a deleted one is not resumed. */
  hasWorkspace?: (workspaceId: string) => boolean;
}

interface ChatReturnPoint {
  location: string;
  focus: Element | null;
}

const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable
    || target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || Boolean(target.closest('[contenteditable="true"]'));
};

export const useChatNavigation = ({
  activeView,
  location,
  setLocation,
  activeTarget,
  broker,
  openDockChat,
  isOverlayOpen,
  openShortcuts,
  hasWorkspace,
}: UseChatNavigationOptions) => {
  const [initialTarget, setInitialTarget] = useState<ChatTarget | null>(null);
  const returnPointRef = useRef<ChatReturnPoint | null>(null);
  // The Pulse Agent rail entry resumes the last conversation shown on the
  // chat page. Before the first one in this run, or when the page was left
  // on a chat with no session yet, it opens the launcher instead.
  const resumeTargetRef = useRef<ChatTarget | null>(null);
  const isChatView = activeView === 'chat';

  useEffect(() => {
    if (isChatView && activeTarget?.surface === 'page') {
      resumeTargetRef.current = activeTarget.sessionId ? activeTarget : null;
    }
  }, [activeTarget, isChatView]);

  const enterChatTarget = useCallback((target: ChatTarget | null) => {
    // Completion toasts may target another durable conversation while the
    // full-page chat is already visible, so this publishes the target in
    // place too rather than treating the navigation as a no-op.
    if (!isChatView) {
      returnPointRef.current = { location, focus: document.activeElement };
    }
    // The location store re-renders synchronously and skips a pending state
    // update, so commit the target first. Otherwise the page mounts on the
    // previous target and loads its session before this one.
    flushSync(() => setInitialTarget(target));
    if (!isChatView) setLocation('/chat');
  }, [isChatView, location, setLocation]);

  const enterChatView = useCallback(() => {
    enterChatTarget(activeTarget);
  }, [activeTarget, enterChatTarget]);

  // On the launcher or chat page, the entry opens the launcher, so it always
  // remains one click away.
  const enterPulseAgent = useCallback(() => {
    const resumeTarget = resumeTargetRef.current;
    const scope = resumeTarget?.scope;
    if (scope?.kind === 'workspace' && hasWorkspace && !hasWorkspace(scope.workspaceId)) {
      resumeTargetRef.current = null;
    } else if (resumeTarget && activeView !== 'home' && !isChatView) {
      enterChatTarget(resumeTarget);
      return;
    }
    setLocation('/home');
  }, [activeView, enterChatTarget, hasWorkspace, isChatView, setLocation]);

  const exitChatView = useCallback(() => {
    const returnPoint = returnPointRef.current;
    returnPointRef.current = null;
    setLocation(returnPoint?.location ?? '/');
    const focus = returnPoint?.focus;
    if (focus instanceof HTMLElement && focus.isConnected) {
      requestAnimationFrame(() => focus.focus());
    }
  }, [setLocation]);

  const focusVisibleChat = useCallback(() => {
    void broker.deliver({ kind: 'focus' });
  }, [broker]);

  const openAndFocusDockChat = useCallback(() => {
    if (activeTarget?.surface === 'page') {
      focusVisibleChat();
      return;
    }
    openDockChat();
    // Dock state and its portal commit in the next frame; focus through the
    // broker only after the newly visible composer has registered.
    requestAnimationFrame(() => {
      void broker.deliver({ kind: 'focus' });
    });
  }, [activeTarget?.surface, broker, focusVisibleChat, openDockChat]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (isOverlayOpen || event.defaultPrevented || isImeComposing(event)) return;
      const editable = isEditableTarget(event.target);

      if (!editable && (event.key === '?' || (event.shiftKey && event.key === '/'))) {
        event.preventDefault();
        openShortcuts();
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.shiftKey) {
        const key = event.key.toLowerCase();
        if (key === 'l') {
          event.preventDefault();
          if (activeView === 'chat') exitChatView();
          else enterChatView();
          return;
        }
        if (key === 'a') {
          event.preventDefault();
          openAndFocusDockChat();
          return;
        }
      }

    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    activeView,
    enterChatView,
    enterChatTarget,
    exitChatView,
    isOverlayOpen,
    openAndFocusDockChat,
    openShortcuts,
  ]);

  return {
    enterChatTarget,
    enterChatView,
    enterPulseAgent,
    exitChatView,
    initialTarget,
    isChatView,
    openAndFocusDockChat,
  };
};
