import { useEffect } from 'react';

/**
 * On mount, drain URLs that the OS handed to Pulse Canvas before a renderer
 * could receive them — a cold start launched by a default-browser link
 * activation. Warm activations arrive over `link:open` instead, so this only
 * covers the launch case. `open` is invoked once per queued URL.
 *
 * `ready` must stay false until the caller's active workspace has resolved
 * past its mount-time placeholder. Draining earlier races the (fast,
 * in-memory) pending-URL fetch against the (slower, disk-backed) workspace
 * restore: `open` would create the tab against the placeholder workspace,
 * which the restore then overwrites with its stale persisted session.
 */
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
    // `open` is intentionally excluded: pending URLs are drained once, the
    // first time `ready` flips true, not on every identity change of `open`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);
}
