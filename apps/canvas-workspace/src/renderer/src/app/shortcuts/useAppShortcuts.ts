import { useEffect, useRef } from 'react';
import { isImeComposing } from '../../utils/ime';
import { matchShortcut, type AppShortcutId } from '../../shortcuts/registry';
import { useWebviewShortcutBridge } from '../../platform/browser/useWebviewShortcutBridge';
import { toggleTheme } from '../../shared/theme';
import { isGlobalChatLauncherVisible, useRightDock } from '../../modules/dock';

interface Options {
  /** True while a modal/overlay owns the keyboard. */
  isOverlayOpen: boolean;
  openShortcuts: () => void;
  toggleChatPage: () => void;
  toggleSidebar: () => void;
  /** Hide or restore the sidebar and the dock together. */
  togglePanels: () => void;
  /** Jump to the nth (1-based) workspace, if it exists. */
  selectWorkspaceByIndex: (index: number) => void;
  /** Close the active workspace tab; false when no tab bar is showing. */
  closeActiveTab: () => boolean;
  /** Reopen the last closed workspace tab; false when no tab bar is showing. */
  reopenClosedTab: () => boolean;
  /**
   * Toggle the dock chat on routes without a canvas; false on the canvas
   * route, where the canvas layer owns the side-chat chord.
   */
  toggleDockChat: () => boolean;
}

/**
 * The tab bar owns its open-tab state and loads lazily, so the shortcut
 * layer asks it to close the active tab with this window event.
 */
export const CLOSE_ACTIVE_TAB_EVENT = 'pulse:close-active-workspace-tab';
export const REOPEN_CLOSED_TAB_EVENT = 'pulse:reopen-closed-workspace-tab';

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
  isOverlayOpen,
  openShortcuts,
  toggleChatPage,
  toggleSidebar,
  togglePanels,
  selectWorkspaceByIndex,
  closeActiveTab,
  reopenClosedTab,
  toggleDockChat,
}: Options) => {
  const toggleDockChatRef = useRef(toggleDockChat);
  toggleDockChatRef.current = toggleDockChat;
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
    'app.togglePanels': (event) => {
      event.preventDefault();
      togglePanels();
    },
    'app.toggleTheme': (event) => {
      event.preventDefault();
      toggleTheme();
    },
    'app.switchWorkspace': (event) => {
      const index = Number.parseInt(event.key, 10);
      if (!Number.isFinite(index)) return;
      event.preventDefault();
      selectWorkspaceByIndex(index);
    },
    'app.closeTab': (event) => {
      // Off the canvas route there is no tab bar; leave the key alone.
      if (closeActiveTab()) event.preventDefault();
    },
    'app.reopenTab': (event) => {
      if (reopenClosedTab()) event.preventDefault();
    },
  };

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (overlayRef.current) return;
      if (event.defaultPrevented) return;
      if (isImeComposing(event)) return;
      if (event.repeat) return;

      const match = matchShortcut(event, 'app');
      if (!match) {
        // The floating chat button names this chord on every page, but its
        // canvas-layer owner is locked off the canvas route.
        if (matchShortcut(event, 'canvas')?.id !== 'canvas.toggleChatPanel') return;
        if (toggleDockChatRef.current()) event.preventDefault();
        return;
      }
      if (match.definition.editable !== 'allow' && isEditableTarget(event.target)) return;

      handlersRef.current[match.id as AppShortcutId](event);
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
};

interface AppShortcutBindingsOptions {
  activeView: string;
  isOverlayOpen: boolean;
  openShortcuts: () => void;
  toggleSidebar: () => void;
  togglePanels: () => void;
  workspaces: Array<{ id: string }>;
  selectWorkspace: (id: string) => void;
  setLocation: (path: string) => void;
  routes: { canvas: string; chat: string };
}

/** Connect app-level shortcuts, including chords forwarded from webview guests. */
export const useAppShortcutBindings = ({
  activeView,
  isOverlayOpen,
  openShortcuts,
  toggleSidebar,
  togglePanels,
  workspaces,
  selectWorkspace,
  setLocation,
  routes,
}: AppShortcutBindingsOptions): void => {
  const dock = useRightDock();
  useWebviewShortcutBridge();
  useAppShortcuts({
    isOverlayOpen,
    openShortcuts,
    toggleChatPage: () => setLocation(activeView === 'chat' ? routes.canvas : routes.chat),
    toggleSidebar,
    togglePanels,
    selectWorkspaceByIndex: (index) => {
      const workspace = workspaces[index - 1];
      if (workspace) selectWorkspace(workspace.id);
    },
    closeActiveTab: () => {
      if (activeView !== 'canvas') return false;
      window.dispatchEvent(new Event(CLOSE_ACTIVE_TAB_EVENT));
      return true;
    },
    reopenClosedTab: () => {
      if (activeView !== 'canvas') return false;
      window.dispatchEvent(new Event(REOPEN_CLOSED_TAB_EVENT));
      return true;
    },
    toggleDockChat: () => {
      if (!isGlobalChatLauncherVisible(activeView)) return false;
      dock.toggleChat();
      return true;
    },
  });
};
