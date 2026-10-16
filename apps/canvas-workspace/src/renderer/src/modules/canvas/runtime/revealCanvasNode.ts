import type { CanvasNode, CanvasTransform } from '../../../types';

/** Loaded only for an explicit reference action; normal canvas startup needs no observer. */
export const revealCanvasNode = (
  container: HTMLElement,
  node: CanvasNode,
  getTransform: () => CanvasTransform,
  setTransform: (transform: CanvasTransform) => void,
  signal: AbortSignal,
): void => {
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
  };
  signal.addEventListener('abort', cleanup, { once: true });
  frame = requestAnimationFrame(reveal);
};
