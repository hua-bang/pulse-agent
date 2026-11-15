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

/**
 * A stored chat session the palette asks the app to open. `storeId` is the
 * session store the search hit came from (a workspace id, the global chat,
 * or a scheduled task store).
 */
export interface OpenChatSessionRequest {
  sessionId: string;
  storeId: string;
  /** Label for the owning scope, shown until the page resolves it. */
  label: string;
}

const OPEN_CHAT_SESSION_EVENT = 'pulse:open-chat-session';

export const requestOpenChatSession = (request: OpenChatSessionRequest): void => {
  window.dispatchEvent(new CustomEvent<OpenChatSessionRequest>(OPEN_CHAT_SESSION_EVENT, { detail: request }));
};

/** Subscribe to palette requests to open a chat session; returns the unsubscribe. */
export const onOpenChatSessionRequest = (
  listener: (request: OpenChatSessionRequest) => void,
): (() => void) => {
  const handler = (event: Event) => listener((event as CustomEvent<OpenChatSessionRequest>).detail);
  window.addEventListener(OPEN_CHAT_SESSION_EVENT, handler);
  return () => window.removeEventListener(OPEN_CHAT_SESSION_EVENT, handler);
};
