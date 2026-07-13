/**
 * Always-on jank recorder for real sessions.
 *
 * The scenario monitor (`monitor.ts`) only observes inside an explicit
 * `__pulsePerf.begin()/end()` window, so day-to-day jank leaves no trace.
 * This module keeps a cheap long-animation-frame observer running for the
 * whole session and records only material stalls (blocking ≥ 50ms) into a
 * ring buffer at `window.__pulseJank`, tagging each sample with the canvas
 * load state — current scale and in-viewport live iframe count — the two
 * factors measured to dominate large-canvas jank
 * (docs/performance-verification-large-canvas.md).
 *
 * Cost model: the observer itself is passive; tag collection walks the DOM
 * only when a ≥50ms stall already happened (rare by definition). Nothing is
 * reported anywhere — the buffer is a local diagnosis surface for DevTools /
 * the harness (`window.__pulseJank`).
 */

export interface JankSample {
  /** ms since navigation start (performance.now clock). */
  at: number;
  durMs: number;
  blockingMs: number;
  /** Settled canvas scale (from --canvas-scale), null when no canvas. */
  scale: number | null;
  /** Live inline iframes + webviews currently intersecting the viewport. */
  visibleEmbeds: number;
  /** Total canvas nodes mounted (both layers of a frame count once). */
  canvasNodes: number;
}

export const JANK_BLOCKING_THRESHOLD_MS = 50;
const MAX_SAMPLES = 200;

declare global {
  interface Window {
    __pulseJank?: JankSample[];
  }
}

interface LoafLikeEntry extends PerformanceEntry {
  blockingDuration?: number;
}

const readLoadState = (): Pick<JankSample, 'scale' | 'visibleEmbeds' | 'canvasNodes'> => {
  const transformEl = document.querySelector<HTMLElement>('.canvas-transform');
  const rawScale = transformEl
    ? getComputedStyle(transformEl).getPropertyValue('--canvas-scale').trim()
    : '';
  const scale = rawScale ? Number.parseFloat(rawScale) : NaN;
  let visibleEmbeds = 0;
  for (const el of document.querySelectorAll('.canvas-node iframe, .canvas-node webview')) {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    if (rect.right < 0 || rect.bottom < 0 || rect.left > window.innerWidth || rect.top > window.innerHeight) continue;
    visibleEmbeds += 1;
  }
  return {
    scale: Number.isFinite(scale) ? scale : null,
    visibleEmbeds,
    // Frames render twice (title overlay + body layer) — count the body
    // layer only so the number matches the logical node count.
    canvasNodes:
      document.querySelectorAll('.canvas-node').length -
      document.querySelectorAll('.canvas-node--frame-title-overlay').length,
  };
};

/** Push one sample (already past the threshold) into the ring buffer. */
export const recordJankSample = (durMs: number, blockingMs: number): JankSample => {
  const sample: JankSample = {
    at: Math.round(performance.now()),
    durMs: Math.round(durMs),
    blockingMs: Math.round(blockingMs),
    ...readLoadState(),
  };
  const buffer = (window.__pulseJank ??= []);
  buffer.push(sample);
  if (buffer.length > MAX_SAMPLES) buffer.splice(0, buffer.length - MAX_SAMPLES);
  return sample;
};

let installed = false;

/** Idempotently start the session-wide long-animation-frame recorder. */
export const installJankMonitor = (): void => {
  if (installed) return;
  installed = true;
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const blocking = (entry as LoafLikeEntry).blockingDuration ?? entry.duration;
        if (blocking < JANK_BLOCKING_THRESHOLD_MS) continue;
        recordJankSample(entry.duration, blocking);
      }
    });
    observer.observe({ type: 'long-animation-frame', buffered: false } as PerformanceObserverInit);
  } catch {
    // Entry type unsupported on this Chromium — recorder stays inert.
  }
};
