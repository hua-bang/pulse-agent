import { useEffect, useRef, useState } from 'react';
import type { EmbeddedWebviewTag } from '../EmbeddedBrowser/types';
import type { WebviewRestoreTarget } from '../IframeNodeBody/useWebviewDiscard';

const BACKGROUND_FRAME_RATE = 1;
const ACTIVE_FRAME_RATE = 60;
// Dock tabs are general-purpose business pages (uploads, collaboration,
// dashboards), so use a much longer grace period than offscreen canvas
// embeds. Paint still drops to 1fps immediately; only JS/network freezing is
// delayed to reduce the chance of interrupting legitimate background work.
const DEFAULT_FREEZE_DELAY_MS = 30 * 60_000;
const FREEZE_RETRY_MS = 60_000;
const REGISTRATION_RETRY_MS = 250;
const REGISTRATION_RETRIES = 4;

interface DiscardOptions {
  workspaceId: string;
  tabId: string | undefined;
  enabled: boolean;
  active: boolean;
  tabUrl: string;
}

/**
 * Owns the renderer half of Memory-Saver discard for right-dock webviews.
 * Unlike canvas nodes, dock panes have reliable active/inactive state, so a
 * discarded tab stays unmounted until it is explicitly activated instead of
 * using geometry-based dwell (inactive panes keep an in-viewport layout box).
 */
export const useDockWebviewDiscard = ({
  workspaceId,
  tabId,
  enabled,
  active,
  tabUrl,
}: DiscardOptions) => {
  const [discarded, setDiscarded] = useState(false);
  const [restore, setRestore] = useState<WebviewRestoreTarget | null>(null);

  useEffect(() => {
    if (!enabled || !workspaceId || !tabId) return;
    const onDiscarded = window.canvasWorkspace?.iframe?.onDiscarded;
    if (typeof onDiscarded !== 'function') return;
    return onDiscarded((payload) => {
      if (payload.workspaceId !== workspaceId || payload.nodeId !== tabId) return;
      setRestore({
        url: payload.restoreUrl || undefined,
        scrollX: typeof payload.scrollX === 'number' ? payload.scrollX : 0,
        scrollY: typeof payload.scrollY === 'number' ? payload.scrollY : 0,
      });
      setDiscarded(true);
    });
  }, [enabled, workspaceId, tabId]);

  // Activating a discarded dock tab is the explicit wake gesture. Keep the
  // restore target across the remount so the guest loads its freeze-time URL
  // and useWebviewRestore can put its scroll position back.
  useEffect(() => {
    if (active && discarded) setDiscarded(false);
  }, [active, discarded]);

  const previousUrlRef = useRef(tabUrl);
  useEffect(() => {
    if (previousUrlRef.current === tabUrl) return;
    previousUrlRef.current = tabUrl;
    setRestore(null);
  }, [tabUrl]);

  return { discarded, restore };
};

interface BackgroundOptions {
  webview: EmbeddedWebviewTag | null;
  workspaceId: string;
  tabId: string | undefined;
  enabled: boolean;
  active: boolean;
  freezeDelayMs?: number;
}

/**
 * Applies the existing webview lifecycle ladder to right-dock link tabs.
 * Hidden dock panes still intersect the viewport and therefore cannot reuse
 * the canvas node's IntersectionObserver signal; the dock's active/split
 * state is the authoritative visibility signal here.
 */
export const useDockWebviewBackgroundLifecycle = ({
  webview,
  workspaceId,
  tabId,
  enabled,
  active,
  freezeDelayMs = DEFAULT_FREEZE_DELAY_MS,
}: BackgroundOptions): void => {
  useEffect(() => {
    if (!enabled || !workspaceId || !tabId || !webview) return;
    const api = window.canvasWorkspace.iframe;
    let cancelled = false;
    let frozen = false;
    let freezeTimer: ReturnType<typeof setTimeout> | null = null;
    const retryTimers = new Set<ReturnType<typeof setTimeout>>();

    const setFrameRate = (frameRate: number, retries = REGISTRATION_RETRIES): void => {
      void api.setFrameRate(workspaceId, tabId, frameRate).then((result) => {
        if (cancelled || result.ok || retries <= 0) return;
        const timer = setTimeout(() => {
          retryTimers.delete(timer);
          setFrameRate(frameRate, retries - 1);
        }, REGISTRATION_RETRY_MS);
        retryTimers.add(timer);
      }).catch(() => {});
    };

    const setActive = (retries = REGISTRATION_RETRIES): void => {
      void api.setLifecycle(workspaceId, tabId, 'active').then((result) => {
        if (cancelled || result.ok || retries <= 0) return;
        const timer = setTimeout(() => {
          retryTimers.delete(timer);
          setActive(retries - 1);
        }, REGISTRATION_RETRY_MS);
        retryTimers.add(timer);
      }).catch(() => {});
    };

    const freeze = (): void => {
      freezeTimer = null;
      if (cancelled) return;
      void api.setLifecycle(workspaceId, tabId, 'frozen').then((result) => {
        if (result.ok) {
          if (cancelled) {
            void api.setLifecycle(workspaceId, tabId, 'active').catch(() => {});
          } else {
            frozen = true;
          }
          return;
        }
        // Temporary exemptions and transient failures retry while the tab
        // stays idle. Permanent policy exemptions must not generate one
        // lifecycle request per minute forever.
        if (!cancelled && result.retryable) {
          freezeTimer = setTimeout(freeze, FREEZE_RETRY_MS);
        }
      }).catch(() => {});
    };

    if (active) {
      // Both operations are idempotent. Registration and this effect start in
      // the same commit, so frame-rate retries cover the brief attach race.
      setActive();
      setFrameRate(ACTIVE_FRAME_RATE);
    } else {
      // No pixels from an inactive pane are visible, so throttle paint
      // immediately. Freeze later to stop guest JS/timers/network as well.
      setFrameRate(BACKGROUND_FRAME_RATE);
      freezeTimer = setTimeout(freeze, freezeDelayMs);
    }

    return () => {
      cancelled = true;
      if (freezeTimer) clearTimeout(freezeTimer);
      for (const timer of retryTimers) clearTimeout(timer);
      // A workspace-key change can keep the same webview element alive. Thaw
      // under the old key before registration moves to the new one, otherwise
      // the new key would inherit a frozen WebContents without a freeze record.
      if (frozen) void api.setLifecycle(workspaceId, tabId, 'active').catch(() => {});
    };
  }, [webview, workspaceId, tabId, enabled, active, freezeDelayMs]);
};
