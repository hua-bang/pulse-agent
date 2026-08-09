import { useEffect, useState, type RefObject } from 'react';

/**
 * Defer an expensive mount (e.g. a live <webview> guest process + external
 * navigation) until its host is actually near the viewport.
 *
 * Creating the webview synchronously on first render puts a guest process and
 * network navigation on the startup critical path (perf finding D1) and also
 * spins up off-screen iframe nodes on large canvases. This gates the mount on
 * an IntersectionObserver: for an in-view host it flips true on the next tick
 * (after first paint, off the critical path); an off-screen host stays false
 * until scrolled near. Once true it stays true — the caller owns lifecycle
 * from there.
 */
export const useDeferredVisibleMount = (
  ref: RefObject<HTMLElement | null>,
  rootMargin = '200px',
  /**
   * Re-arm the observer when this changes. Needed when the observed element
   * is rendered conditionally (e.g. the inline-iframe pending shell only
   * exists outside url/streaming modes): the mount-time effect would capture
   * a null ref and never retry otherwise.
   */
  rearmKey?: unknown,
): boolean => {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (visible) return;
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, rootMargin, visible, rearmKey]);
  return visible;
};
