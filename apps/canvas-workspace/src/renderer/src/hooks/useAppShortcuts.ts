import { useEffect, useRef } from 'react';
import { isImeComposing } from '../utils/ime';
import { matchShortcut, type AppShortcutId } from '../shortcuts/registry';

interface Options {
  /** Current route bucket — only 'chat' reacts to the chat-page Escape. */
  activeView: string;
  /** True while a modal/overlay owns the keyboard. */
  isOverlayOpen: boolean;
  openShortcuts: () => void;
  toggleChatPage: () => void;
  toggleSidebar: () => void;
  /** Jump to the nth (1-based) workspace, if it exists. */
  selectWorkspaceByIndex: (index: number) => void;
  leaveChatPage: () => void;
}

const isEditableTarget = (target: EventTarget | null): boolean => {
  const element = target as HTMLElement | null;
  return Boolean(element) && (
    element?.tagName === 'INPUT'
    || element?.tagName === 'TEXTAREA'
    || element?.isContentEditable === true
  );
};

/**
 * App-chrome keyboard layer — the shortcuts that work on every route, not
 * just on a canvas. Bindings come from `shortcuts/registry.ts`; the handler
 * table is typed `Record<AppShortcutId, …>` so the registry and this hook
 * cannot drift apart.
 *
 * Split from the canvas layer on purpose: the canvas layer is gated on the
 * visible, unlocked canvas, while these must keep working on the chat page
 * and the node pages.
 */
export const useAppShortcuts = ({
  activeView,
  isOverlayOpen,
  openShortcuts,
  toggleChatPage,
  toggleSidebar,
  selectWorkspaceByIndex,
  leaveChatPage,
}: Options) => {
  const handlersRef = useRef<Record<AppShortcutId, (event: KeyboardEvent) => void>>(null as never);
  const overlayRef = useRef(isOverlayOpen);
  overlayRef.current = isOverlayOpen;

  handlersRef.current = {
    'app.shortcutsHelp': (event) => {
      event.preventDefault();
      openShortcuts();
    },
    'app.toggleChatPage': (event) => {
      event.preventDefault();
      toggleChatPage();
    },
    'app.toggleSidebar': (event) => {
      event.preventDefault();
      toggleSidebar();
    },
    'app.switchWorkspace': (event) => {
      const index = Number.parseInt(event.key, 10);
      if (!Number.isFinite(index)) return;
      event.preventDefault();
      selectWorkspaceByIndex(index);
    },
    'app.escapeChatPage': () => {
      if (activeView !== 'chat') return;
      // Last handler in the Escape chain, so there is nothing downstream to
      // protect from a double-fire. The canvas layer marks the event when it
      // consumed Escape, and the dispatcher above skips consumed events — so
      // reaching here means nothing else claimed it.
      leaveChatPage();
    },
  };

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (overlayRef.current) return;
      if (event.defaultPrevented) return;
      if (isImeComposing(event)) return;
      if (event.repeat) return;

      const match = matchShortcut(event, 'app');
      if (!match) return;
      if (match.definition.editable !== 'allow' && isEditableTarget(event.target)) return;

      handlersRef.current[match.definition.id as AppShortcutId](event);
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
};
