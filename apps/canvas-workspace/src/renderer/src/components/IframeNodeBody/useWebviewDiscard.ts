import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

/**
 * Renderer half of L3 webview discard (Memory Saver style — see
 * main/webview/discard-monitor.ts). Main decides WHICH long-frozen guest to
 * discard when total webview memory exceeds budget; this hook receives the
 * notification, flips the node into the discarded state (the caller feeds
 * `!discarded` into useEmbeddedBrowser's `enabled`, which unmounts the
 * `<webview>` and kills the guest process), and owns the wake contract:
 * dwelling in the viewport (so a pan-past doesn't trigger a reload storm)
 * or an explicit click re-enables the webview — the same
 * activate-to-restore behavior as Chrome's Memory Saver.
 *
 * Restore: the discard payload carries the freeze-time record's real guest
 * URL and scroll position. The caller feeds `restore.url` into the webview
 * mount (falling back to the node's saved url) and useWebviewRestore
 * scrolls back once the remounted guest reaches dom-ready.
 */

const WAKE_DWELL_MS = 2_000;
const SCROLL_RESTORE_TIMEOUT_MS = 2_000;

export interface WebviewRestoreTarget {
  /** Guest URL at freeze time; undefined = record had none — use node url. */
  url?: string;
  scrollX: number;
  scrollY: number;
}

interface Options {
  workspaceId: string | undefined;
  nodeId: string;
  /** False outside url mode — the subscription stays off entirely. */
  enabled: boolean;
  /** Observed for the dwell-to-wake check. The webview host stays rendered
   *  while discarded (the placeholder overlays it), so this ref is stable. */
  hostRef: RefObject<HTMLElement | null>;
  /** The node's saved url. A user-committed url change invalidates any
   *  pending restore — the user's navigation intent wins over the record. */
  nodeUrl: string;
}

export const useWebviewDiscard = ({ workspaceId, nodeId, enabled, hostRef, nodeUrl }: Options) => {
  // null = live; string = discarded ('' when the snapshot capture failed
  // and the placeholder falls back to the title/favicon card).
  const [snapshot, setSnapshot] = useState<string | null>(null);
  // Deliberately sticky ACROSS wake: it keeps feeding the restore url into
  // the remount — clearing it at wake would flip the webview's url prop
  // back to the node url mid-restore and force a second navigation. It is
  // replaced on the next discard, and dropped when the node url changes.
  const [restore, setRestore] = useState<WebviewRestoreTarget | null>(null);
  const discarded = snapshot !== null;

  useEffect(() => {
    if (!enabled || !workspaceId) return;
    const api = window.canvasWorkspace?.iframe;
    if (!api?.onDiscarded) return;
    return api.onDiscarded((payload) => {
      if (payload.workspaceId !== workspaceId || payload.nodeId !== nodeId) return;
      setSnapshot(payload.snapshotDataUrl ?? '');
      setRestore({
        url: payload.restoreUrl || undefined,
        scrollX: typeof payload.scrollX === 'number' ? payload.scrollX : 0,
        scrollY: typeof payload.scrollY === 'number' ? payload.scrollY : 0,
      });
    });
  }, [enabled, workspaceId, nodeId]);

  const lastNodeUrlRef = useRef(nodeUrl);
  useEffect(() => {
    if (lastNodeUrlRef.current === nodeUrl) return;
    lastNodeUrlRef.current = nodeUrl;
    setRestore(null);
  }, [nodeUrl]);

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

  return { discarded, snapshot, restore, wake };
};

/** The <webview> surface the restore needs; executeJavaScript is optional so
 *  test doubles (plain elements) pass through the guard instead of casting. */
type RestorableWebview = HTMLElement & {
  executeJavaScript?: (code: string) => Promise<unknown>;
};

/**
 * Scrolls a freshly re-mounted (woken) webview back to the freeze-time
 * position once its guest reaches dom-ready. Applies each restore target
 * once — a later manual reload should not yank the user's scroll again.
 * The guest script is time-bounded and fire-and-forget: a slow or wedged
 * guest must never hold anything up (same rule as main's bounded captures).
 */
export const useWebviewRestore = (
  webview: RestorableWebview | null,
  restore: WebviewRestoreTarget | null,
): void => {
  const appliedRef = useRef<WebviewRestoreTarget | null>(null);
  useEffect(() => {
    if (!webview || !restore) return;
    if (appliedRef.current === restore) return;
    const handleDomReady = () => {
      appliedRef.current = restore;
      const x = Number.isFinite(restore.scrollX) ? restore.scrollX : 0;
      const y = Number.isFinite(restore.scrollY) ? restore.scrollY : 0;
      if ((x === 0 && y === 0) || typeof webview.executeJavaScript !== 'function') return;
      void Promise.race([
        webview
          .executeJavaScript(`window.scrollTo(${x}, ${y})`)
          .catch(() => undefined),
        new Promise((resolve) => setTimeout(resolve, SCROLL_RESTORE_TIMEOUT_MS)),
      ]);
    };
    webview.addEventListener('dom-ready', handleDomReady);
    return () => webview.removeEventListener('dom-ready', handleDomReady);
  }, [webview, restore]);
};
