import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type {
  ActiveChatTarget,
  ChatTarget,
  ChatTargetBroker,
} from '../ChatTargetContext';
import { activeChatTargetFromRegisteredTarget } from '../ChatTargetContext';
import { isImeComposing } from '../../../utils/ime';

interface UseChatNavigationOptions {
  activeView: string;
  location: string;
  scheduledTaskId?: string | null;
  setLocation: (path: string) => void;
  activeTarget: ChatTarget | null;
  broker: ChatTargetBroker;
  openDockChat: () => void;
  isOverlayOpen: boolean;
  openShortcuts: () => void;
}

interface ChatReturnPoint {
  location: string;
  focus: HTMLElement | null;
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
  scheduledTaskId,
  setLocation,
  activeTarget,
  broker,
  openDockChat,
  isOverlayOpen,
  openShortcuts,
}: UseChatNavigationOptions) => {
  const scheduledTarget = (taskId: string): ActiveChatTarget => ({
    scope: { kind: 'scheduled', taskId },
    sessionId: null,
    executionPolicy: 'scheduled',
  });
  const [storedChatTarget, setActiveChatTarget] = useState<ActiveChatTarget>(
    () => scheduledTaskId
      ? scheduledTarget(scheduledTaskId)
      : activeChatTargetFromRegisteredTarget(null),
  );
  const appliedScheduledTaskRef = useRef(scheduledTaskId ?? null);
  const hasPendingScheduledRoute = Boolean(
    scheduledTaskId && appliedScheduledTaskRef.current !== scheduledTaskId,
  );
  const activeChatTarget = hasPendingScheduledRoute
    ? scheduledTarget(scheduledTaskId!)
    : storedChatTarget;
  const returnPointRef = useRef<ChatReturnPoint | null>(null);
  const isChatView = activeView === 'chat';

  useLayoutEffect(() => {
    if (!scheduledTaskId) {
      appliedScheduledTaskRef.current = null;
      return;
    }
    if (appliedScheduledTaskRef.current === scheduledTaskId) return;
    appliedScheduledTaskRef.current = scheduledTaskId;
    setActiveChatTarget(scheduledTarget(scheduledTaskId));
  }, [scheduledTaskId]);

  const enterChatTarget = useCallback((target: ChatTarget | null) => {
    if (activeView === 'chat') return;
    returnPointRef.current = {
      location,
      focus: document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null,
    };
    setActiveChatTarget(activeChatTargetFromRegisteredTarget(target));
    setLocation('/chat');
  }, [activeView, location, setLocation]);

  const enterChatView = useCallback(() => {
    enterChatTarget(activeTarget);
  }, [activeTarget, enterChatTarget]);

  const exitChatView = useCallback(() => {
    const returnPoint = returnPointRef.current;
    returnPointRef.current = null;
    setLocation(returnPoint?.location ?? '/');
    if (returnPoint?.focus?.isConnected) {
      requestAnimationFrame(() => returnPoint.focus?.focus());
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

      if (event.key === 'Escape' && activeView === 'chat') {
        event.preventDefault();
        exitChatView();
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
    exitChatView,
    activeChatTarget,
    setActiveChatTarget,
    isChatView,
    openAndFocusDockChat,
  };
};
