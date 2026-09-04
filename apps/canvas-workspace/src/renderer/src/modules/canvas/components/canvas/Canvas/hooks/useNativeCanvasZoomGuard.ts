import { useEffect, type RefObject } from 'react';

export const useNativeCanvasZoomGuard = (
  containerRef: RefObject<HTMLElement>,
  ready: boolean,
): void => {
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return undefined;
    const blockPageZoom = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) event.preventDefault();
    };
    element.addEventListener('wheel', blockPageZoom, { passive: false });
    return () => element.removeEventListener('wheel', blockPageZoom);
  }, [containerRef, ready]);
};
