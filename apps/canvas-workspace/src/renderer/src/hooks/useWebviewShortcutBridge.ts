import { useEffect } from 'react';

/**
 * Re-dispatches shortcut keystrokes that a `<webview>` guest swallowed.
 *
 * Guests are separate renderer processes: their keydowns never reach this
 * window, which made every embedded page a keyboard black hole. Main watches
 * `before-input-event` on each guest and forwards the whitelist in
 * `shared/webview-shortcuts.ts` here; turning the payload back into a real
 * `keydown` on `window` means the ordinary shortcut dispatchers handle it
 * with no special-casing on their side.
 *
 * Deliberately re-dispatch rather than call handlers directly: the canvas
 * and app layers own their own guards (locked canvas, open overlay, focused
 * input), and routing through a real event keeps exactly one set of rules.
 */
export const useWebviewShortcutBridge = (): void => {
  useEffect(() => {
    const api = window.canvasWorkspace?.iframe;
    if (!api?.onShortcut) return;

    return api.onShortcut(({ key, control, meta, alt, shift }) => {
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key,
        ctrlKey: control,
        metaKey: meta,
        altKey: alt,
        shiftKey: shift,
        bubbles: true,
        cancelable: true,
      }));
    });
  }, []);
};
