/**
 * Terminal-scoped shortcut dispatch, for xterm's `attachCustomKeyEventHandler`.
 *
 * This is the third dispatcher, alongside `useCanvasKeyboard` (owner
 * `canvas`) and `useAppShortcuts` (owner `app`). It exists because a focused
 * terminal is a scope, not a route: a chord it claims must beat the global
 * layers *while it has focus* and mean nothing anywhere else. `RightDock`'s
 * `DOCK_FOCUS_SCOPED_COMMANDS` is the same idea one surface over.
 *
 * ## Why claiming needs `preventDefault`
 *
 * Returning `false` from an xterm custom key handler stops XTERM ONLY — the
 * DOM event keeps bubbling to the `window` keydown listeners that
 * `useCanvasKeyboard` and `useAppShortcuts` install. Four surfaces had
 * hand-written `if (key === '2' && (ctrlKey || metaKey))` and returned false
 * for it, so Cmd+2 in a terminal or coding-agent node opened the node-mention
 * picker AND fell through to `app.switchWorkspace`, which switched workspace
 * out from under the user. Both dispatchers skip an event whose
 * `defaultPrevented` is set, so `preventDefault` — not the `false` return —
 * is what actually resolves the collision.
 *
 * ## Why the handlers are an exhaustive Record
 *
 * Same guarantee the other two owners give: `TerminalShortcutId` is a mapped
 * type over the registry, so a definition declared `owner: 'terminal'` with
 * no handler here is a TYPE ERROR, and so is a handler whose definition was
 * deleted. That is what stops a terminal chord from being documented in the
 * help overlay with nothing behind it.
 */
import { matchShortcut } from './registry';
import type { TerminalShortcutId } from './definitions';

export type TerminalShortcutHandlers = Record<TerminalShortcutId, () => void>;

/**
 * Claim a keystroke for the focused terminal surface, ahead of the global
 * dispatchers. Call this for any key the surface handles itself — including
 * chords owned by another layer that the terminal deliberately overrides
 * (the terminal font-size keys, which otherwise ALSO drive `canvas.zoom*`).
 *
 * Returns `false` so a caller can `return claimTerminalKey(event)` straight
 * out of an xterm handler.
 */
export const claimTerminalKey = (event: KeyboardEvent): false => {
  event.preventDefault();
  event.stopPropagation();
  return false;
};

/**
 * Run the terminal-owned shortcut this event matches, if any.
 *
 * Returns true when the surface claimed the key — the caller must then return
 * `false` to xterm so the keystroke never reaches the shell.
 */
export const handleTerminalShortcut = (
  event: KeyboardEvent,
  handlers: TerminalShortcutHandlers,
): boolean => {
  if (event.type !== 'keydown') return false;
  const match = matchShortcut(event, 'terminal');
  if (!match) return false;
  handlers[match.id as TerminalShortcutId]();
  claimTerminalKey(event);
  return true;
};
