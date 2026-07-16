import { useEffect } from 'react';

/**
 * On mount, drain URLs that the OS handed to Pulse Canvas before a renderer
 * could receive them — a cold start launched by a default-browser link
 * activation. Warm activations arrive over `link:open` instead, so this only
 * covers the launch case. `open` is invoked once per queued URL.
 */
export function useConsumePendingLinks(open: (url: string) => void): void {
  useEffect(() => {
    let cancelled = false;
    void window.canvasWorkspace.defaultBrowser
      .consumePending()
      .then(({ urls }) => {
        if (cancelled) return;
        for (const url of urls) open(url);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // Intentionally mount-only: pending URLs are drained once at startup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
