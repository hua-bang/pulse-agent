import { useEffect, useRef } from 'react';

/**
 * Background paint-rate throttling for canvas webview nodes.
 *
 * When a webview node sits outside the canvas viewport for long enough, we
 * drop its `setFrameRate` to a low value (default 1fps). The guest process
 * stays alive — JS, timers, network, in-page state are all preserved — so
 * coming back to the node is instantaneous and lossless. The win is GPU
 * paint work and Chromium tile memory: an offscreen webview that used to
 * paint at 60fps no longer competes for tiles with what the user is
 * actually looking at.
 *
 * Why not just unmount the <webview>?  Detaching the element kills the
 * guest renderer process, which then has to re-fetch the page, lose form
 * state, and re-establish any in-page session on remount. Throttling keeps
 * everything alive.
 *
 * Why not change document.visibilityState?  Some pages (Figma, video sites,
 * dashboards) react to visibilitychange by tearing down state we don't
 * want torn down. Frame-rate throttling is invisible to the page.
 *
 * Hysteresis matters: pan-by motions briefly take a node out of the
 * viewport, but the user might be panning toward it. We use a generous
 * `rootMargin` so a node must be solidly outside the viewport to count as
 * offscreen, plus a delay before we actually drop the frame rate. Coming
 * back into the viewport always restores immediately.
 */

interface Options {
  /** The element to observe. Typically the webview's host container. */
  hostRef: React.RefObject<HTMLElement | null>;
  /** Identifies the registered webview in main's registry. */
  workspaceId: string | undefined;
  nodeId: string;
  /**
   * When true the hook stays inactive — used to skip throttling while the
   * node is in editing mode or has no live webview to control.
   */
  disabled?: boolean;
  /** How far past the viewport edge a node still counts as visible. */
  rootMargin?: string;
  /** How long offscreen before we drop the frame rate. */
  offscreenDelayMs?: number;
  /** Throttled frame rate. Clamped to [1, 240] in main. */
  throttledFrameRate?: number;
  /** Restored frame rate when back on screen. */
  defaultFrameRate?: number;
}

const DEFAULT_ROOT_MARGIN = '300px';
const DEFAULT_OFFSCREEN_DELAY_MS = 1_500;
const DEFAULT_THROTTLED_FRAME_RATE = 1;
const DEFAULT_FRAME_RATE = 60;

export const useWebviewBackgroundThrottle = ({
  hostRef,
  workspaceId,
  nodeId,
  disabled = false,
  rootMargin = DEFAULT_ROOT_MARGIN,
  offscreenDelayMs = DEFAULT_OFFSCREEN_DELAY_MS,
  throttledFrameRate = DEFAULT_THROTTLED_FRAME_RATE,
  defaultFrameRate = DEFAULT_FRAME_RATE,
}: Options) => {
  // Track which rate is currently applied so we don't issue redundant IPC
  // (every pan-by would otherwise spam main with 60→60 noops).
  const appliedRateRef = useRef<number | null>(null);

  useEffect(() => {
    if (disabled || !workspaceId) return;
    const el = hostRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;

    const api = window.canvasWorkspace.iframe;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const apply = (rate: number) => {
      if (appliedRateRef.current === rate) return;
      appliedRateRef.current = rate;
      // setFrameRate calls for unknown nodes resolve to {ok:false} — main
      // logs and we ignore. This is normal during webview boot before
      // registerWebview has completed.
      void api.setFrameRate(workspaceId, nodeId, rate).catch(() => {
        appliedRateRef.current = null; // let next state change retry
      });
    };

    const cancelTimer = () => {
      if (timer != null) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (!entry) return;
        if (entry.isIntersecting) {
          // Back in view — cancel any pending throttle and restore now.
          cancelTimer();
          apply(defaultFrameRate);
        } else {
          // Out of view — schedule throttle if not already scheduled or
          // already throttled. We don't throttle eagerly because pan
          // gestures briefly take many nodes offscreen.
          if (timer != null) return;
          if (appliedRateRef.current === throttledFrameRate) return;
          timer = setTimeout(() => {
            timer = null;
            apply(throttledFrameRate);
          }, offscreenDelayMs);
        }
      },
      { rootMargin },
    );

    observer.observe(el);

    return () => {
      observer.disconnect();
      cancelTimer();
      // Best-effort restore on teardown so a webview that survives this
      // hook's lifecycle (e.g. via webviewKey reload) doesn't get stuck at
      // 1fps. unregisterWebview happens in the calling effect's cleanup
      // and races with this; the registry returns {ok:false} when the
      // webview is gone, which we silently swallow.
      if (appliedRateRef.current === throttledFrameRate) {
        void api.setFrameRate(workspaceId, nodeId, defaultFrameRate).catch(() => {});
      }
      appliedRateRef.current = null;
    };
  }, [
    hostRef,
    workspaceId,
    nodeId,
    disabled,
    rootMargin,
    offscreenDelayMs,
    throttledFrameRate,
    defaultFrameRate,
  ]);
};
