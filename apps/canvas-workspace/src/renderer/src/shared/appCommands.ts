import { useSyncExternalStore } from 'react';

/**
 * App-wide navigation commands (open a workspace, go to a page) for the
 * Cmd/Ctrl+K palette. The app shortcut layer publishes them; the canvas
 * palette and the off-canvas app palette both read them, so Cmd+K reaches
 * every workspace and page from any route.
 */
export interface AppNavigationCommand {
  id: string;
  title: string;
  aliases?: string[];
  run: () => void;
}

/** Off the canvas route, Cmd/Ctrl+K opens the app palette with this event. */
export const OPEN_APP_COMMAND_PALETTE_EVENT = 'pulse:open-app-command-palette';

export const requestOpenAppCommandPalette = (): void => {
  window.dispatchEvent(new Event(OPEN_APP_COMMAND_PALETTE_EVENT));
};

let current: AppNavigationCommand[] = [];
const listeners = new Set<() => void>();

export const publishAppCommands = (commands: AppNavigationCommand[]): void => {
  current = commands;
  listeners.forEach((listener) => listener());
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const snapshot = () => current;

export const useAppCommands = (): AppNavigationCommand[] => (
  useSyncExternalStore(subscribe, snapshot, snapshot)
);
