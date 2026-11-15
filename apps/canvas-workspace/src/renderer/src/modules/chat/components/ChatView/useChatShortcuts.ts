/**
 * Chat-scoped keyboard shortcuts (owner `chat` in `shortcuts/definitions.ts`).
 *
 * A chat surface is a SCOPE, not a route, the same idea as the terminal
 * owner: these chords act only while focus is inside the chat root (dock
 * chat, side panel, or full chat page). The full chat page also takes them
 * while nothing holds focus (`document.body`), because it is the only
 * surface on that route.
 *
 * Ordering matters. The handler runs as a React `onKeyDown` on the chat root,
 * so it sees a key only AFTER the composer, the mention popup, and the
 * message editor; any of them that used the key calls `preventDefault`, and
 * the dispatcher then skips it (Escape closing an open mention popup never
 * also stops the run). A handled chord calls `preventDefault` and
 * `stopPropagation`, so the window listeners of `useCanvasKeyboard`,
 * `useAppShortcuts`, and the dock never act on the same press.
 *
 * Handlers return false when they do not apply (for example Escape with no
 * running turn). The key then keeps its global meaning.
 */
import { useCallback, useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';
import { matchShortcut, type ChatShortcutId } from '../../../../shortcuts/registry';
import { isImeComposing } from '../../../../utils/ime';

export type ChatShortcutHandlers = Record<ChatShortcutId, (event: KeyboardEvent) => boolean>;

const isEditableTarget = (target: EventTarget | null): boolean => (
  target instanceof HTMLElement
  && (
    target.isContentEditable
    || target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || Boolean(target.closest('[contenteditable=""], [contenteditable="true"]'))
  )
);

/**
 * Run the chat-owned shortcut this event matches, if any. Returns true when
 * the chat claimed the key.
 */
export const dispatchChatShortcut = (
  event: KeyboardEvent,
  handlers: ChatShortcutHandlers,
): boolean => {
  if (event.defaultPrevented || event.repeat || isImeComposing(event)) return false;
  const match = matchShortcut(event, 'chat');
  if (!match) return false;
  if (match.definition.editable !== 'allow' && isEditableTarget(event.target)) return false;
  if (!handlers[match.id as ChatShortcutId](event)) return false;
  event.preventDefault();
  event.stopPropagation();
  return true;
};

interface Options {
  rootRef: RefObject<HTMLElement>;
  editableRef: RefObject<HTMLElement>;
  /** A turn is running in this conversation. */
  running: boolean;
  /** Stop the running turn (callers pass the queue-clearing abort). */
  onAbort: () => Promise<boolean>;
  /** Start a new chat; absent while that is not allowed. */
  onNewSession?: () => void;
  /** The composer cannot take input right now. */
  composerDisabled: boolean;
  /** Full chat page: also own keys typed while nothing holds focus. */
  ownsPageFocus?: boolean;
}

const isRendered = (element: HTMLElement): boolean => (
  element.isConnected
  && (typeof element.checkVisibility === 'function' ? element.checkVisibility() : true)
);

export const useChatShortcuts = ({
  rootRef,
  editableRef,
  running,
  onAbort,
  onNewSession,
  composerDisabled,
  ownsPageFocus = false,
}: Options) => {
  const handlersRef = useRef<ChatShortcutHandlers>(null as never);
  handlersRef.current = {
    'chat.stop': (event) => {
      if (!running) return false;
      // Escape in another field (a rename input, say) belongs to that field.
      if (
        event.key === 'Escape'
        && isEditableTarget(event.target)
        && !editableRef.current?.contains(event.target as Node)
      ) return false;
      void onAbort();
      return true;
    },
    'chat.newSession': () => {
      if (!onNewSession) return false;
      onNewSession();
      return true;
    },
    'chat.focusComposer': () => {
      const editable = editableRef.current;
      if (!editable || composerDisabled) return false;
      editable.focus();
      return true;
    },
  };

  const onKeyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
    // Portaled children (lightbox, menus) bubble through the React tree but
    // are not inside the chat; they keep their own keys.
    if (!rootRef.current?.contains(event.target as Node)) return;
    dispatchChatShortcut(event.nativeEvent, handlersRef.current);
  }, [rootRef]);

  useEffect(() => {
    if (!ownsPageFocus) return;
    // Document bubble phase runs before the window listeners of the other
    // dispatchers, so stopPropagation still keeps the key from them.
    const handler = (event: KeyboardEvent) => {
      if (event.target !== document.body && event.target !== document.documentElement) return;
      const root = rootRef.current;
      if (!root || !isRendered(root)) return;
      dispatchChatShortcut(event, handlersRef.current);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [ownsPageFocus, rootRef]);

  return onKeyDown;
};
