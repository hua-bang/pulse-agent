import { useEffect, useRef } from 'react';
import { isImeComposing } from '../../utils/ime';
import { matchShortcut, type AppShortcutId } from '../../shortcuts/registry';
import { useWebviewShortcutBridge } from '../../platform/browser/useWebviewShortcutBridge';

interface Options {
  /** True while a modal/overlay owns the keyboard. */
  isOverlayOpen: boolean;
  openShortcuts: () => void;
  toggleChatPage: () => void;
  toggleSidebar: () => void;
  /** Jump to the nth (1-based) workspace, if it exists. */
  selectWorkspaceByIndex: (index: number) => void;
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
  isOverlayOpen,
  openShortcuts,
  toggleChatPage,
  toggleSidebar,
  selectWorkspaceByIndex,
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
  workspaces,
  selectWorkspace,
  setLocation,
  routes,
}: AppShortcutBindingsOptions): void => {
  useWebviewShortcutBridge();
  useAppShortcuts({
    isOverlayOpen,
    openShortcuts,
    toggleChatPage: () => setLocation(activeView === 'chat' ? routes.canvas : routes.chat),
    toggleSidebar,
    selectWorkspaceByIndex: (index) => {
      const workspace = workspaces[index - 1];
      if (workspace) selectWorkspace(workspace.id);
    },
  });
};
