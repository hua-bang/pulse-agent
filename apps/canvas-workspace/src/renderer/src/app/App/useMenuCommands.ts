import { useEffect, useRef } from 'react';
import type { AppMenuCommand } from '../../../../shared/api/app-info';
import { SHORTCUTS, type KeyBinding, type ShortcutId } from '../../shortcuts/registry';
import { requestOpenAppSettings, useAppShell } from '../../shared/appShell';
import { usesAppleShortcuts } from '../../utils/keyboardShortcut';

/**
 * Menu commands that have a registry chord replay that chord as a window
 * keydown, as the webview shortcut bridge does. The owning layer then runs
 * its handler with its own route, overlay, and canvas guards, so the menu
 * and the keyboard share one set of rules.
 */
const CHORD_COMMANDS: Partial<Record<AppMenuCommand, ShortcutId>> = {
  'command-palette': 'canvas.commandPalette',
  'toggle-sidebar': 'app.toggleSidebar',
  'toggle-panels': 'app.togglePanels',
  'toggle-chat-page': 'app.toggleChatPage',
};

export const replayShortcut = (id: ShortcutId): void => {
  const binding: KeyBinding | undefined = SHORTCUTS[id].bindings[0];
  if (!binding?.key) return;
  const apple = usesAppleShortcuts();
  window.dispatchEvent(new KeyboardEvent('keydown', {
    key: binding.key,
    metaKey: Boolean(binding.mod && apple),
    ctrlKey: Boolean(binding.ctrl || (binding.mod && !apple)),
    altKey: Boolean(binding.alt),
    shiftKey: Boolean(binding.shift),
    bubbles: true,
    cancelable: true,
  }));
};

interface Options {
  createWorkspace: () => void;
}

/** Run native application-menu commands in this window. */
export const useMenuCommands = ({ createWorkspace }: Options): void => {
  const { openShortcuts } = useAppShell();
  const handlersRef = useRef({ createWorkspace, openShortcuts });
  handlersRef.current = { createWorkspace, openShortcuts };

  useEffect(() => {
    const api = window.canvasWorkspace?.appInfo;
    if (!api?.onMenuCommand) return;
    return api.onMenuCommand((command) => {
      const chord = CHORD_COMMANDS[command];
      if (chord) {
        replayShortcut(chord);
        return;
      }
      if (command === 'open-settings') requestOpenAppSettings();
      else if (command === 'new-workspace') handlersRef.current.createWorkspace();
      // `?` is not replayed: the app layer drops it while a text field has focus.
      else if (command === 'shortcuts-help') handlersRef.current.openShortcuts();
    });
  }, []);
};
