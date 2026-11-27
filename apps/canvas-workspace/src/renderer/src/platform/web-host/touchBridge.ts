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
      const dist = pinchDistance(event.touches);
      const delta = (lastPinchDist - dist) * 1.4;
      lastPinchDist = dist;
      const midX = (event.touches[0].clientX + event.touches[1].clientX) / 2;
      const midY = (event.touches[0].clientY + event.touches[1].clientY) / 2;
      if (Math.abs(delta) > 0.5) {
        event.preventDefault();
        surface.dispatchEvent(
          new WheelEvent('wheel', {
            deltaY: delta,
            ctrlKey: true,
            clientX: midX,
            clientY: midY,
            bubbles: true,
            cancelable: true,
          }),
        );
      }
    }
  };

  const onTouchEnd = (event: TouchEvent) => {
    if (event.touches.length === 1) {
      lastSingle = { x: event.touches[0].clientX, y: event.touches[0].clientY };
      lastPinchDist = null;
    } else if (event.touches.length === 0) {
      lastSingle = null;
      lastPinchDist = null;
    }
  };

  window.addEventListener('touchstart', onTouchStart, { passive: true });
  window.addEventListener('touchmove', onTouchMove, { passive: false });
  window.addEventListener('touchend', onTouchEnd, { passive: true });
  window.addEventListener('touchcancel', onTouchEnd, { passive: true });

  return () => {
    window.removeEventListener('touchstart', onTouchStart);
    window.removeEventListener('touchmove', onTouchMove);
    window.removeEventListener('touchend', onTouchEnd);
    window.removeEventListener('touchcancel', onTouchEnd);
  };
}
