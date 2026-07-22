import { useEffect, useRef } from 'react';
import { subscribeCanvasMotion } from '../../hooks/canvasMotion';

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
  /**
   * How long offscreen before escalating from the frame-rate throttle to a
   * Chrome-style page freeze (L2 — see main/webview/lifecycle.ts). Chrome
   * freezes background tabs after ~5 minutes; same default here. Resume is
   * instantaneous and reload-free.
   */
  freezeDelayMs?: number;
  /** Retry interval after a refused freeze (audible/devtools exemption). */
  freezeRetryMs?: number;
}

const DEFAULT_ROOT_MARGIN = '300px';
const DEFAULT_OFFSCREEN_DELAY_MS = 1_500;
const DEFAULT_THROTTLED_FRAME_RATE = 1;
const DEFAULT_FRAME_RATE = 60;
/**
 * How long after a zoom-out gesture ends before a still-visible guest is
 * restored to full frame rate (P3 gesture lease). Matches useCanvas's
 * MOVING_IDLE_MS so a rapid re-zoom doesn't thrash 60→1→60.
 */
const GESTURE_RESTORE_MS = 180;
const DEFAULT_FREEZE_DELAY_MS = 5 * 60_000;
const DEFAULT_FREEZE_RETRY_MS = 60_000;
/**
 * Applied to the webview host while frozen, so a frozen guest also stops
 * being composited/painted. NOT a freeze precondition: real-Electron CI
 * verification showed guest document.visibilityState stays 'visible'
 * regardless of the element's CSS (guest visibility tracks the embedder
 * window), which is why main's frozen path pairs the lifecycle freeze with
 * a script-execution-disable guarantee — see main/webview/lifecycle.ts.
 * visibility:hidden (not display:none, which webview handles badly) is a
 * visual no-op here: the node is offscreen by definition, and main
 * snapshots the last frame BEFORE this class lands.
 */
const FROZEN_HIDDEN_CLASS = 'iframe-frame-host--frozen';

export const useWebviewBackgroundThrottle = ({
  hostRef,
  workspaceId,
  nodeId,
  disabled = false,
  rootMargin = DEFAULT_ROOT_MARGIN,
  offscreenDelayMs = DEFAULT_OFFSCREEN_DELAY_MS,
  throttledFrameRate = DEFAULT_THROTTLED_FRAME_RATE,
  defaultFrameRate = DEFAULT_FRAME_RATE,
  freezeDelayMs = DEFAULT_FREEZE_DELAY_MS,
  freezeRetryMs = DEFAULT_FREEZE_RETRY_MS,
}: Options) => {
  // Track which rate is currently applied so we don't issue redundant IPC
  // (every pan-by would otherwise spam main with 60→60 noops).
  const appliedRateRef = useRef<number | null>(null);
  // Track the applied lifecycle so resume IPC only fires when frozen.
  const frozenRef = useRef(false);

  useEffect(() => {
    if (disabled || !workspaceId) return;
    const el = hostRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;

    const api = window.canvasWorkspace.iframe;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let freezeTimer: ReturnType<typeof setTimeout> | null = null;
    let offscreen = false;

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
    const cancelFreezeTimer = () => {
      if (freezeTimer != null) {
        clearTimeout(freezeTimer);
        freezeTimer = null;
      }
    };

    // L2: after minutes offscreen, escalate from the 1fps throttle to a
    // Chrome-style freeze (task queues suspended, memory kept, resume is
    // reload-free). A refused freeze (audible page / DevTools open — the
    // same exemptions Chrome uses) re-arms a retry while still offscreen.
    const tryFreeze = () => {
      freezeTimer = null;
      if (!offscreen || frozenRef.current) return;
      void api
        .setLifecycle(workspaceId, nodeId, 'frozen')
        .then((result) => {
          if (result.ok) {
            // The freeze IPC can take a couple of seconds (bounded snapshot
            // in main). If the node re-entered the viewport meanwhile,
            // resume() already ran with frozenRef still false and sent no
            // 'active' — undo immediately instead of leaving a VISIBLE
            // guest with scripts disabled.
            if (!offscreen) {
              void api.setLifecycle(workspaceId, nodeId, 'active').catch(() => {});
              return;
            }
            frozenRef.current = true;
            // Hide AFTER main captured the last-frame snapshot inside the
            // frozen call — see FROZEN_HIDDEN_CLASS.
            el.classList.add(FROZEN_HIDDEN_CLASS);
          } else if (offscreen && result.retryable) {
            freezeTimer = setTimeout(tryFreeze, freezeRetryMs);
          }
        })
        .catch(() => {});
    };

    const resume = () => {
      // Unhide first so the node paints as soon as the 'active' IPC below
      // re-enables the guest (script re-enable + lifecycle resume in main).
      el.classList.remove(FROZEN_HIDDEN_CLASS);
      if (!frozenRef.current) return;
      frozenRef.current = false;
      void api.setLifecycle(workspaceId, nodeId, 'active').catch(() => {});
    };

    // Frame-rate is the LOWEST of three independent throttles (P3): the
    // offscreen background throttle (delayed, hysteresis for pan), the
    // gesture lease (immediate 1fps while a heavy zoom-out is in flight — the
    // deep-band raster of every in-viewport guest is the 60.9% cost the probe
    // measured), and overview (a settled guest below 0.35 scale is a tiny
    // occluded thumbnail, not worth 60fps). One decision so they never fight.
    let offscreenThrottleActive = false;
    let gestureLeased = false;
    let gestureRestoreTimer: ReturnType<typeof setTimeout> | null = null;
    const transformAncestor = el.closest('.canvas-transform');
    const overviewActive = () =>
      transformAncestor?.classList.contains('canvas-transform--overview') ?? false;
    const syncRate = () => {
      apply(
        offscreenThrottleActive || gestureLeased || overviewActive()
          ? throttledFrameRate
          : defaultFrameRate,
      );
    };

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (!entry) return;
        if (entry.isIntersecting) {
          // Back in view — cancel pending throttle/freeze, resume first so
          // the page's task queues are running again, then restore paint
          // (unless the gesture lease or overview still wants it low).
          offscreen = false;
          offscreenThrottleActive = false;
          cancelTimer();
          cancelFreezeTimer();
          resume();
          syncRate();
        } else {
          // Out of view — schedule throttle if not already scheduled or
          // already throttled. We don't throttle eagerly because pan
          // gestures briefly take many nodes offscreen.
          offscreen = true;
          if (freezeTimer == null && !frozenRef.current) {
            freezeTimer = setTimeout(tryFreeze, freezeDelayMs);
          }
          if (timer != null || offscreenThrottleActive) return;
          timer = setTimeout(() => {
            timer = null;
            offscreenThrottleActive = true;
            syncRate();
          }, offscreenDelayMs);
        }
      },
      { rootMargin },
    );

    observer.observe(el);

    // P3 gesture lease: drop every mounted guest to 1fps the instant a heavy
    // zoom-out starts, restore GESTURE_RESTORE_MS after it ends (only if the
    // guest isn't independently offscreen/overview-throttled — syncRate
    // decides). Reuses the same registry/IPC as the offscreen throttle.
    const unsubscribeMotion = subscribeCanvasMotion((state) => {
      const wantLease = state.mode === 'zoom-out' && state.heavy;
      if (wantLease) {
        if (gestureRestoreTimer != null) {
          clearTimeout(gestureRestoreTimer);
          gestureRestoreTimer = null;
        }
        if (!gestureLeased) {
          gestureLeased = true;
          syncRate();
        }
      } else if (gestureLeased && gestureRestoreTimer == null) {
        gestureRestoreTimer = setTimeout(() => {
          gestureRestoreTimer = null;
          gestureLeased = false;
          syncRate();
        }, GESTURE_RESTORE_MS);
      }
    });

    return () => {
      observer.disconnect();
      unsubscribeMotion();
      if (gestureRestoreTimer != null) clearTimeout(gestureRestoreTimer);
      cancelTimer();
      cancelFreezeTimer();
      // Best-effort restore on teardown so a webview that survives this
      // hook's lifecycle (e.g. via webviewKey reload) doesn't get stuck at
      // 1fps or frozen. unregisterWebview happens in the calling effect's
      // cleanup and races with this; the registry returns {ok:false} when
      // the webview is gone, which we silently swallow.
      resume();
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
    freezeDelayMs,
    freezeRetryMs,
  ]);
};
