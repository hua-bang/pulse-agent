import { useEffect } from 'react';

/** Drain URLs handed to the app before the renderer became ready. */
export function useConsumePendingLinks(open: (url: string) => void, ready: boolean): void {
  useEffect(() => {
    if (!ready) return;
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
    // Pending URLs are drained once when readiness first becomes true.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);
}
