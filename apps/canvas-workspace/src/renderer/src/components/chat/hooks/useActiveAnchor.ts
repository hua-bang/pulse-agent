import { useEffect, useState, type RefObject } from 'react';
import { buildAnchorElementId, type ChatAnchor } from '../utils/anchors';

/**
 * Scroll-spy for the chat anchor rail.
 *
 * Returns the message index of the anchor whose target element sits closest
 * to the top of `containerRef`'s scrollable viewport. The "activation line"
 * is a fixed offset below the container's top edge — once a message scrolls
 * past it, it becomes the active anchor.
 */
export const useActiveAnchor = (
  containerRef: RefObject<HTMLElement>,
  anchors: ChatAnchor[],
  workspaceId: string,
): number | null => {
  const [activeIndex, setActiveIndex] = useState<number | null>(
    anchors[0]?.index ?? null,
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container || anchors.length === 0) {
      setActiveIndex(anchors[0]?.index ?? null);
      return;
    }

    let frame = 0;
    const compute = () => {
      const containerTop = container.getBoundingClientRect().top;
      const activationOffset = 72;
      let active = anchors[0].index;
      for (const anchor of anchors) {
        const el = document.getElementById(
          buildAnchorElementId(workspaceId, anchor.index),
        );
        if (!el) continue;
        const top = el.getBoundingClientRect().top - containerTop;
        if (top - activationOffset <= 0) {
          active = anchor.index;
        } else {
          break;
        }
      }
      setActiveIndex(active);
    };

    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        compute();
      });
    };

    compute();
    container.addEventListener('scroll', schedule, { passive: true });
    const ro = new ResizeObserver(schedule);
    ro.observe(container);

    return () => {
      container.removeEventListener('scroll', schedule);
      ro.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [containerRef, anchors, workspaceId]);

  return activeIndex;
};
