/**
 * Keyboard ownership for the dock: browsing shortcuts (from this window AND
 * relayed from focused guest pages) plus the Escape policy.
 *
 * Escape is deliberately asymmetric. Cheap, reconstructible panes — artifact,
 * node detail, canvas preview, skill — close, matching "Escape dismisses".
 * A web tab does not: it holds history, scroll position and sign-in state
 * that a stray keypress must not destroy, so Escape steps out of the dock and
 * leaves the tab standing. ⌘/Ctrl+W is the deliberate close, and it is
 * undoable via ⌘/Ctrl+Shift+T.
 */
import { useEffect } from 'react';
import { resolveDockBrowserCommand } from '../../../../shared/dock-shortcuts';
import { isImeComposing } from '../../utils/ime';
import { applyDockBrowserCommand } from './dock-browser-commands';
import { CHAT_TAB_ID } from './dock-tab-ids';
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

interface Options {
  store: DockStore;
  /** Only bind while the dock is actually on screen. */
  visible: boolean;
  /** i18n title for ⌘T — the store is framework-free and has no `t`. */
  newTabTitle: string;
}

export const useDockKeyboard = ({ store, visible, newTabTitle }: Options): void => {
  useEffect(() => {
    if (!visible) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isImeComposing(event)) return;
      const command = resolveDockBrowserCommand(event);
      if (command) {
        if (applyDockBrowserCommand(command, store, store.getSnapshot(), newTabTitle)) {
          event.preventDefault();
        }
        return;
      }
      if (event.key !== 'Escape' || isEditableEventTarget(event.target)) return;
      const { activeTabId, terminalTabs, tabs } = store.getSnapshot();
      if (terminalTabs.some((tab) => tab.id === activeTabId)) {
        store.closeTerminal(activeTabId);
        return;
      }
      if (activeTabId === CHAT_TAB_ID) return;
      if (tabs.find((tab) => tab.id === activeTabId)?.kind === 'link') {
        store.collapse();
        return;
      }
      store.close(activeTabId);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, store, newTabTitle]);

  // Keys pressed while an embedded page has focus never reach this window;
  // main resolves them against the same policy and relays the command.
  useEffect(() => {
    const dock = window.canvasWorkspace?.dock;
    if (!dock?.onShortcut) return;
    return dock.onShortcut(({ command }) => {
      applyDockBrowserCommand(command, store, store.getSnapshot(), newTabTitle);
    });
  }, [store, newTabTitle]);
};
