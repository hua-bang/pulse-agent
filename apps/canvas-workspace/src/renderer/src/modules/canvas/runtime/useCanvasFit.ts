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

  // A canvas behind another route (Knowledge, Graph, Chat) has a 0x0 box.
  // "Open on canvas" requests the focus before that route shows the canvas,
  // and framing against an empty rect lands at minimum zoom, far from the
  // node. Defer the framing until the container has a real size; a newer
  // framing request or unmount drops the pending one.
  const pendingFrameCleanup = useRef<() => void>();
  useEffect(() => () => pendingFrameCleanup.current?.(), []);
  const whenSized = useCallback((frame: (rect: DOMRect) => void) => {
    pendingFrameCleanup.current?.();
    pendingFrameCleanup.current = undefined;
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      frame(rect);
      return;
    }
    const observer = new ResizeObserver(() => {
      const next = container.getBoundingClientRect();
      if (next.width <= 0 || next.height <= 0) return;
      observer.disconnect();
      pendingFrameCleanup.current = undefined;
      frame(next);
    });
    observer.observe(container);
    pendingFrameCleanup.current = () => observer.disconnect();
  }, [containerRef]);

  const handleFocusNode = useCallback(
    (
      node: CanvasNode,
      options?: { padding?: number; maxScale?: number; minScale?: number },
    ) => {
      whenSized((rect) => {
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
      });
    },
    [setTransform, triggerAnimation, whenSized]
  );

  const animateTransform = useCallback(
    (next: CanvasTransform) => {
      setTransform(next);
      triggerAnimation();
    },
    [setTransform, triggerAnimation]
  );

  const fitAllNodes = useCallback(
    (nodeList: CanvasNode[]) => {
      if (nodeList.length === 0) return;
      whenSized((rect) => {
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
      });
    },
    [setTransform, triggerAnimation, whenSized]
  );

  const revealCleanup = useRef<() => void>();
  useEffect(() => () => revealCleanup.current?.(), []);

  // Follow only this explicit reference action through dock reflow. Stop as
  // soon as the user interacts again; later navigation owns its own viewport.
  const revealNode = useCallback(async (node: CanvasNode, getTransform: () => CanvasTransform) => {
    revealCleanup.current?.();
    const container = containerRef.current;
    if (!container) return;
    const controller = new AbortController();
    const cancel = () => controller.abort();
    revealCleanup.current = cancel;
    const options = { capture: true, once: true, signal: controller.signal };
    document.addEventListener('pointerdown', cancel, options);
    document.addEventListener('wheel', cancel, options);
    try {
      const { revealCanvasNode } = await import('./revealCanvasNode');
      if (!controller.signal.aborted) {
        revealCanvasNode(container, node, getTransform, setTransform, controller.signal);
      }
    } catch {
      cancel();
    }
  }, [containerRef, setTransform]);

  return { animating, handleFocusNode, animateTransform, fitAllNodes, revealNode };
};
