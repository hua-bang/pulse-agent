import { useCallback, useEffect, useRef, useState } from 'react';
import type { CanvasNode, CanvasTransform } from '../../../types';

export const useCanvasFit = (
  containerRef: React.RefObject<HTMLDivElement | null>,
  setTransform: (t: CanvasTransform) => void,
) => {
  const [animating, setAnimating] = useState(false);
  const animTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const triggerAnimation = useCallback(() => {
    setAnimating(true);
    if (animTimerRef.current) clearTimeout(animTimerRef.current);
    animTimerRef.current = setTimeout(() => setAnimating(false), 380);
  }, []);

  const handleFocusNode = useCallback(
    (
      node: CanvasNode,
      options?: { padding?: number; maxScale?: number; minScale?: number },
    ) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const padding = options?.padding ?? 80;
      const maxScale = options?.maxScale ?? 1.5;
      const minScale = options?.minScale ?? 0.1;
      const fitScale = Math.min(
        (rect.width - padding * 2) / node.width,
        (rect.height - padding * 2) / node.height
      );
      const targetScale = Math.min(Math.max(minScale, fitScale), maxScale);
      const tx = rect.width / 2 - (node.x + node.width / 2) * targetScale;
      const ty = rect.height / 2 - (node.y + node.height / 2) * targetScale;
      setTransform({ x: tx, y: ty, scale: targetScale });
      triggerAnimation();
    },
    [containerRef, setTransform, triggerAnimation]
  );

  const fitAllNodes = useCallback(
    (nodeList: CanvasNode[]) => {
      if (!containerRef.current || nodeList.length === 0) return;
      const rect = containerRef.current.getBoundingClientRect();
      const padding = 80;
      const minX = Math.min(...nodeList.map((n) => n.x));
      const minY = Math.min(...nodeList.map((n) => n.y));
      const maxX = Math.max(...nodeList.map((n) => n.x + n.width));
      const maxY = Math.max(...nodeList.map((n) => n.y + n.height));
      const boundsW = maxX - minX;
      const boundsH = maxY - minY;
      if (boundsW === 0 || boundsH === 0) return;
      const fitScale = Math.min(
        (rect.width - padding * 2) / boundsW,
        (rect.height - padding * 2) / boundsH
      );
      const targetScale = Math.min(Math.max(0.1, fitScale), 1.5);
      const tx = rect.width / 2 - (minX + boundsW / 2) * targetScale;
      const ty = rect.height / 2 - (minY + boundsH / 2) * targetScale;
      setTransform({ x: tx, y: ty, scale: targetScale });
      triggerAnimation();
    },
    [containerRef, setTransform, triggerAnimation]
  );

  const revealCleanup = useRef<() => void>();
  useEffect(() => () => revealCleanup.current?.(), []);

  // Follow only this explicit reference action through dock reflow. Stop as
  // soon as the user interacts again; later navigation owns its own viewport.
  const revealNode = useCallback((node: CanvasNode, getTransform: () => CanvasTransform) => {
    revealCleanup.current?.();
    const container = containerRef.current;
    if (!container) return;
    let frame = 0;
    const reveal = () => {
      const rect = container.getBoundingClientRect();
      const dock = document.querySelector<HTMLElement>('.right-dock[data-expanded="true"]');
      const dockRect = dock?.getBoundingClientRect();
      const right = dockRect && dockRect.bottom > rect.top && dockRect.top < rect.bottom
        ? Math.min(rect.right, dockRect.left) : rect.right;
      const width = right - rect.left;
      if (width <= 48 || rect.height <= 48) return;
      const current = getTransform();
      const offset = (start: number, size: number, available: number) => {
        const end = start + size;
        if (size > available - 48) return (available - size) / 2 - start;
        if (start < 24) return 24 - start;
        return end > available - 24 ? available - 24 - end : 0;
      };
      const dx = offset(node.x * current.scale + current.x, node.width * current.scale, width);
      const dy = offset(node.y * current.scale + current.y, node.height * current.scale, rect.height);
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
        setTransform({ ...current, x: current.x + dx, y: current.y + dy });
      }
    };
    const observer = new ResizeObserver(reveal);
    observer.observe(container);
    const dock = document.querySelector<HTMLElement>('.right-dock');
    if (dock) observer.observe(dock);
    // A translated dock does not trigger ResizeObserver at transition end.
    dock?.addEventListener('transitionend', reveal);
    const cleanup = () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      dock?.removeEventListener('transitionend', reveal);
      document.removeEventListener('pointerdown', cleanup, true);
      document.removeEventListener('wheel', cleanup, true);
    };
    document.addEventListener('pointerdown', cleanup, true);
    document.addEventListener('wheel', cleanup, true);
    frame = requestAnimationFrame(reveal);
    revealCleanup.current = cleanup;
  }, [containerRef, setTransform]);

  return { animating, handleFocusNode, fitAllNodes, revealNode };
};
