import { useEffect } from 'react';

/** Re-dispatch shortcut input forwarded from an isolated webview guest. */
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
