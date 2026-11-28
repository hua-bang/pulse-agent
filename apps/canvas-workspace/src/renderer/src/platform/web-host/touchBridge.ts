/**
 * Lightweight mobile H5 touch bridge for the desktop-first canvas surface.
 * Translates single-finger pan and two-finger pinch gestures on `.canvas-container`
 * into standard wheel events consumed by the existing canvas camera controller.
 */
export function installMobileTouchBridge(): () => void {
  let lastSingle: { x: number; y: number } | null = null;
  let lastPinchDist: number | null = null;

  const isInteractiveTarget = (target: EventTarget | null): boolean => {
    if (!(target instanceof Element)) return false;
    return Boolean(
      target.closest(
        'button, a, input, textarea, select, [contenteditable="true"], .right-dock, .floating-toolbar, .zoom-indicator-group, .workspace-tabs',
      ),
    );
  };

  const findCanvasSurface = (target: EventTarget | null): Element | null => {
    if (!(target instanceof Element)) return null;
    return target.closest('.canvas-container, .canvas-root');
  };

  const pinchDistance = (touches: TouchList): number => {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.hypot(dx, dy);
  };

  const onTouchStart = (event: TouchEvent) => {
    if (isInteractiveTarget(event.target) || !findCanvasSurface(event.target)) {
      lastSingle = null;
      lastPinchDist = null;
      return;
    }
    if (event.touches.length === 1) {
      lastSingle = { x: event.touches[0].clientX, y: event.touches[0].clientY };
      lastPinchDist = null;
    } else if (event.touches.length === 2) {
      lastSingle = null;
      lastPinchDist = pinchDistance(event.touches);
    }
  };

  let pendingPinchDelta = 0;
  let pendingPinchTarget: Element | null = null;
  let pendingPinchMid = { x: 0, y: 0 };
  let pinchRafId: number | null = null;
  let lastPinchFlushAt = 0;

  const flushPinch = () => {
    pinchRafId = null;
    if (!pendingPinchTarget || Math.abs(pendingPinchDelta) < 0.5) {
      pendingPinchDelta = 0;
      return;
    }
    const now = performance.now();
    if (now - lastPinchFlushAt < 32) {
      pinchRafId = window.requestAnimationFrame(flushPinch);
      return;
    }
    lastPinchFlushAt = now;
    const clamped = Math.max(-36, Math.min(36, pendingPinchDelta));
    const target = pendingPinchTarget;
    const { x, y } = pendingPinchMid;
    pendingPinchDelta = 0;
    target.dispatchEvent(
      new WheelEvent('wheel', {
        deltaY: clamped,
        ctrlKey: true,
        clientX: x,
        clientY: y,
        bubbles: true,
        cancelable: true,
      }),
    );
  };

  const onTouchMove = (event: TouchEvent) => {
    const surface = findCanvasSurface(event.target);
    if (!surface || isInteractiveTarget(event.target)) return;

    if (event.touches.length === 1 && lastSingle) {
      const dx = lastSingle.x - event.touches[0].clientX;
      const dy = lastSingle.y - event.touches[0].clientY;
      lastSingle = { x: event.touches[0].clientX, y: event.touches[0].clientY };
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
        event.preventDefault();
        surface.dispatchEvent(
          new WheelEvent('wheel', {
            deltaX: dx,
            deltaY: dy,
            clientX: event.touches[0].clientX,
            clientY: event.touches[0].clientY,
            bubbles: true,
            cancelable: true,
          }),
        );
      }
      return;
    }

    if (event.touches.length === 2 && lastPinchDist !== null) {
      event.preventDefault();
      const dist = pinchDistance(event.touches);
      const delta = (lastPinchDist - dist) * 1.1;
      lastPinchDist = dist;
      if (Math.abs(delta) > 0.5) {
        pendingPinchDelta += delta;
        pendingPinchTarget = surface;
        pendingPinchMid = {
          x: (event.touches[0].clientX + event.touches[1].clientX) / 2,
          y: (event.touches[0].clientY + event.touches[1].clientY) / 2,
        };
        if (pinchRafId === null) {
          pinchRafId = window.requestAnimationFrame(flushPinch);
        }
      }
    }
  };

  const clearPendingPinch = () => {
    if (pinchRafId !== null) {
      window.cancelAnimationFrame(pinchRafId);
      pinchRafId = null;
    }
    pendingPinchDelta = 0;
    pendingPinchTarget = null;
  };

  const onTouchEnd = (event: TouchEvent) => {
    if (event.touches.length < 2) {
      clearPendingPinch();
    }
    if (event.touches.length === 1) {
      lastSingle = { x: event.touches[0].clientX, y: event.touches[0].clientY };
      lastPinchDist = null;
    } else if (event.touches.length === 0) {
      lastSingle = null;
      lastPinchDist = null;
    }
  };

  // Prevent iOS Safari native pinch-zoom gesture from racing with our CSS canvas scale().
  const preventSafariGesture = (event: Event) => {
    if (findCanvasSurface(event.target)) {
      event.preventDefault();
    }
  };

  window.addEventListener('touchstart', onTouchStart, { passive: true });
  window.addEventListener('touchmove', onTouchMove, { passive: false });
  window.addEventListener('touchend', onTouchEnd, { passive: true });
  window.addEventListener('touchcancel', onTouchEnd, { passive: true });
  window.addEventListener('gesturestart', preventSafariGesture, { passive: false });
  window.addEventListener('gesturechange', preventSafariGesture, { passive: false });
  window.addEventListener('gestureend', preventSafariGesture, { passive: false });

  return () => {
    clearPendingPinch();
    window.removeEventListener('touchstart', onTouchStart);
    window.removeEventListener('touchmove', onTouchMove);
    window.removeEventListener('touchend', onTouchEnd);
    window.removeEventListener('touchcancel', onTouchEnd);
    window.removeEventListener('gesturestart', preventSafariGesture);
    window.removeEventListener('gesturechange', preventSafariGesture);
    window.removeEventListener('gestureend', preventSafariGesture);
  };
}
