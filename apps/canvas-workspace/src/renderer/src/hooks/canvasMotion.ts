/**
 * Canvas gesture-motion signal — the shared source of truth for
 * "a pan/zoom gesture is in flight and of what kind", so gesture-time
 * optimizations (inline-iframe static-ization, webview frame-rate lease,
 * decoration flattening) all key off ONE decision instead of re-deriving it.
 *
 * Two sinks, one source (useCanvas.handleWheel / pan handlers):
 *  - CSS reads `data-motion` / `data-heavy-embeds` written straight onto the
 *    `.canvas-transform` element (no React commit per wheel tick — the whole
 *    point of the rAF-direct-DOM transform path).
 *  - JS (useWebviewBackgroundThrottle's gesture lease) reads it here via
 *    subscribe(), because a <webview>'s frame rate is an IPC call, not CSS.
 *
 * `heavy` gates the expensive path to canvases that actually have enough live
 * embeds to be worth it (>= HEAVY_EMBED_THRESHOLD) — a 2-node canvas must not
 * pay static-ization churn on every wheel tick.
 */

export type CanvasMotionMode = 'idle' | 'pan' | 'zoom-in' | 'zoom-out';

export interface CanvasMotionState {
  mode: CanvasMotionMode;
  heavy: boolean;
}

/** Live inline iframes + <webview> guests at/above which a canvas counts as
 * embed-heavy and opts into gesture-time static-ization. */
export const HEAVY_EMBED_THRESHOLD = 8;

const state: CanvasMotionState = { mode: 'idle', heavy: false };
const listeners = new Set<(s: CanvasMotionState) => void>();

export const getCanvasMotion = (): CanvasMotionState => state;

/** True while a heavy zoom-out gesture is active — the condition the webview
 * frame-rate lease and inline static-ization both switch on. */
export const isHeavyZoomOut = (): boolean => state.mode === 'zoom-out' && state.heavy;

export const subscribeCanvasMotion = (
  listener: (s: CanvasMotionState) => void,
): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const setCanvasMotion = (mode: CanvasMotionMode, heavy: boolean): void => {
  if (state.mode === mode && state.heavy === heavy) return;
  state.mode = mode;
  state.heavy = heavy;
  for (const listener of [...listeners]) {
    try {
      listener(state);
    } catch {
      // a subscriber's failure must not wedge the gesture
    }
  }
};
