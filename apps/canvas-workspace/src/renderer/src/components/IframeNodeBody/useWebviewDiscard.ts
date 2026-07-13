import { useCallback, useEffect, useState, type RefObject } from 'react';

/**
 * Renderer half of L3 webview discard (Memory Saver style — see
 * main/webview/discard-monitor.ts). Main decides WHICH long-frozen guest to
 * discard when total webview memory exceeds budget; this hook receives the
 * notification, flips the node into the discarded state (the caller feeds
 * `!discarded` into useEmbeddedBrowser's `enabled`, which unmounts the
 * `<webview>` and kills the guest process), and owns the wake contract:
 * dwelling in the viewport (so a pan-past doesn't trigger a reload storm)
 * or an explicit click re-enables the webview, which reloads the page —
 * the same activate-to-restore behavior as Chrome's Memory Saver.
 */

const WAKE_DWELL_MS = 2_000;

interface Options {
  workspaceId: string | undefined;
  nodeId: string;
  /** False outside url mode — the subscription stays off entirely. */
  enabled: boolean;
  /** Observed for the dwell-to-wake check. The webview host stays rendered
   *  while discarded (the placeholder overlays it), so this ref is stable. */
  hostRef: RefObject<HTMLElement | null>;
}

export const useWebviewDiscard = ({ workspaceId, nodeId, enabled, hostRef }: Options) => {
  // null = live; string = discarded ('' when the snapshot capture failed
  // and the placeholder falls back to the title/favicon card).
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const discarded = snapshot !== null;

  useEffect(() => {
    if (!enabled || !workspaceId) return;
    const api = window.canvasWorkspace?.iframe;
    if (!api?.onDiscarded) return;
    return api.onDiscarded((payload) => {
      if (payload.workspaceId !== workspaceId || payload.nodeId !== nodeId) return;
      setSnapshot(payload.snapshotDataUrl ?? '');
    });
  }, [enabled, workspaceId, nodeId]);

  useEffect(() => {
    if (!discarded) return;
    const el = hostRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    let dwell: ReturnType<typeof setTimeout> | null = null;
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (!entry) return;
      if (entry.isIntersecting) {
        if (dwell == null) {
          dwell = setTimeout(() => {
            dwell = null;
            setSnapshot(null);
          }, WAKE_DWELL_MS);
        }
      } else if (dwell != null) {
        clearTimeout(dwell);
        dwell = null;
      }
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      if (dwell != null) clearTimeout(dwell);
    };
  }, [discarded, hostRef]);

  const wake = useCallback(() => setSnapshot(null), []);

  return { discarded, snapshot, wake };
};
