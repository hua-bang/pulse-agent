import {
  useCallback,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';

interface PanStart {
  left: number;
  pointerId: number;
  top: number;
  x: number;
  y: number;
}

export const useMindmapDetailPan = (
  enabled: boolean,
  containerRef: RefObject<HTMLDivElement | null>,
) => {
  const panRef = useRef<PanStart | null>(null);
  const [isPanning, setIsPanning] = useState(false);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!enabled || event.button !== 0 || !(event.target instanceof Element)) return;
    if (event.target.closest('[data-detail-pan-block], button, input, textarea, [contenteditable="true"]')) return;
    const container = containerRef.current;
    if (!container) return;

    event.preventDefault();
    panRef.current = {
      left: container.scrollLeft,
      top: container.scrollTop,
      x: event.clientX,
      y: event.clientY,
      pointerId: event.pointerId,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setIsPanning(true);
  }, [containerRef, enabled]);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const start = panRef.current;
    const container = containerRef.current;
    if (!start || !container || start.pointerId !== event.pointerId) return;
    container.scrollLeft = start.left - (event.clientX - start.x);
    container.scrollTop = start.top - (event.clientY - start.y);
  }, [containerRef]);

  const stopPan = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const start = panRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    panRef.current = null;
    setIsPanning(false);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
  }, []);

  const onKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!enabled) return;
    const delta = event.shiftKey ? 120 : 40;
    if (event.key === 'ArrowLeft') event.currentTarget.scrollLeft -= delta;
    else if (event.key === 'ArrowRight') event.currentTarget.scrollLeft += delta;
    else if (event.key === 'ArrowUp') event.currentTarget.scrollTop -= delta;
    else if (event.key === 'ArrowDown') event.currentTarget.scrollTop += delta;
    else return;
    event.preventDefault();
  }, [enabled]);

  const center = useCallback(() => {
    const container = containerRef.current;
    const root = container?.querySelector<HTMLElement>('[data-mindmap-root="true"]');
    if (!container || !root) return;
    const containerRect = container.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    container.scrollLeft += rootRect.left - containerRect.left + rootRect.width / 2 - container.clientWidth / 2;
    container.scrollTop += rootRect.top - containerRect.top + rootRect.height / 2 - container.clientHeight / 2;
  }, [containerRef]);

  return {
    center,
    isPanning,
    onKeyDown,
    onLostPointerCapture: stopPan,
    onPointerCancel: stopPan,
    onPointerDown,
    onPointerMove,
    onPointerUp: stopPan,
  };
};
