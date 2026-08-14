/**
 * Keyboard ownership for the dock: browsing shortcuts (from this window AND
 * relayed from focused guest pages) plus the Escape policy.
 *
 * Host-chrome Escape is deliberately asymmetric. Cheap, reconstructible panes — artifact,
 * node detail, canvas preview, skill — close, matching "Escape dismisses".
 * A web tab does not: it holds history, scroll position and sign-in state
 * that a stray keypress must not destroy, so Escape steps out of the dock and
 * leaves the tab standing. ⌘/Ctrl+W is the deliberate close, and it is
 * undoable via ⌘/Ctrl+Shift+T. Escape pressed inside a guest stays page-owned,
 * so sites can still dismiss dialogs, menus and fullscreen state.
 */
import { useEffect, type RefObject } from 'react';
import {
  DOCK_FOCUS_SCOPED_COMMANDS,
  resolveDockBrowserCommand,
} from '../../../../../shared/dock-shortcuts';
import { isImeComposing } from '../../../utils/ime';
import { applyDockBrowserCommand, focusActiveDockTarget } from './dock-browser-commands';
import { CHAT_TAB_ID } from './dock-tab-ids';
import { mountedWebviewIdentityForWebContents } from '../../node-bodies/IframeNodeBody/webview-identities';
import type { DockStore } from './dock-store';

const isEditableEventTarget = (target: EventTarget | null): boolean => (
  target instanceof HTMLElement
  && (
    target.isContentEditable
    || target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || Boolean(target.closest('[contenteditable="true"]'))
  )
);

const isDockFocusOwner = (dockRef: RefObject<HTMLElement>): boolean => {
  const active = document.activeElement;
  return Boolean(
    dockRef.current?.contains(active)
    || (active instanceof HTMLElement && active.closest('.context-menu--in-dock')),
  );
};

export interface DockKeyboardOptions {
  store: DockStore;
  /** Only bind while the dock is actually on screen. */
  visible: boolean;
  /** i18n title for ⌘T — the store is framework-free and has no `t`. */
  newTabTitle: string;
  /** The dock element, for scoping chords the canvas also binds. */
  dockRef: RefObject<HTMLElement>;
  /** The exact visible tab order shared with the strip and overflow menu. */
  orderedTabIds: readonly string[];
  /** User exits must restore focus outside a now-hidden dock. */
  onCollapse: () => void;
}

export const useDockKeyboard = ({
  store,
  visible,
  newTabTitle,
  dockRef,
  orderedTabIds,
  onCollapse,
}: DockKeyboardOptions): void => {
  useEffect(() => {
    if (!visible) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isImeComposing(event)) return;
      const command = resolveDockBrowserCommand(event);
      if (command) {
        // ⌘F means find-in-page for the active web tab and find-on-canvas
        // elsewhere. If focus is already inside dock chrome, the dock owns it.
        // If the visible active dock tab is a web page, keep browser muscle
        // memory working even when the host focus is still on the canvas after
        // a tab activation; otherwise leave it to the canvas search handler.
        const state = store.getSnapshot();
        const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId);
        if (
          DOCK_FOCUS_SCOPED_COMMANDS.has(command)
          && !isDockFocusOwner(dockRef)
          && !(command === 'find' && activeTab?.kind === 'link')
        ) {
          return;
        }
        if (applyDockBrowserCommand(
          command,
          store,
          state,
          newTabTitle,
          orderedTabIds,
        )) {
          event.preventDefault();
        }
        return;
      }
      if (event.key !== 'Escape' || isEditableEventTarget(event.target)) return;
      const { activeTabId, terminalTabs, tabs } = store.getSnapshot();
      if (terminalTabs.some((tab) => tab.id === activeTabId)) {
        store.closeTerminal(activeTabId);
        focusActiveDockTarget(store);
        return;
      }
      if (activeTabId === CHAT_TAB_ID) return;
      if (tabs.find((tab) => tab.id === activeTabId)?.kind === 'link') {
        onCollapse();
        return;
      }
      store.close(activeTabId);
      focusActiveDockTarget(store);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, store, newTabTitle, dockRef, orderedTabIds, onCollapse]);

  // Keys pressed while an embedded page has focus never reach this window;
  // main resolves them against the same policy and relays the command.
  useEffect(() => {
    if (!visible) return;
    const dock = window.canvasWorkspace?.dock;
    if (!dock?.onShortcut) return;
    return dock.onShortcut(({ command, source }) => {
      const registered = mountedWebviewIdentityForWebContents(source.webContentsId);
      const state = store.getSnapshot();
      if (
        !registered
        || registered.webContentsId !== source.webContentsId
        || registered.workspaceId !== source.workspaceId
        || registered.nodeId !== source.nodeId
        || registered.surfaceKind !== 'dock-browser'
        || source.surfaceKind !== 'dock-browser'
        || state.activeTerminalWorkspaceId !== source.workspaceId
        || state.activeTabId !== source.nodeId
        || state.tabs.find((tab) => tab.id === source.nodeId)?.kind !== 'link'
      ) return;
      applyDockBrowserCommand(command, store, state, newTabTitle, orderedTabIds);
    });
  }, [visible, store, newTabTitle, orderedTabIds]);
};
