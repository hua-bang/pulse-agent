import { useEffect, useState, type RefObject } from 'react';

/** Matches `.workspace-node-grid` in index.css. */
const CARD_MIN_WIDTH = 260;
const CARD_GAP = 12;

export const masonryColumnCount = (width: number): number =>
  Math.max(1, Math.floor((width + CARD_GAP) / (CARD_MIN_WIDTH + CARD_GAP)));

/**
 * Deals items left to right across the columns, so reading order runs across
 * rows and every column has a card before any column gets a second one. CSS
 * multi-column balancing instead filled columns top to bottom and could leave
 * the right columns empty.
 */
export const distributeIntoColumns = <T>(items: T[], columns: number): T[][] => {
  const result: T[][] = Array.from({ length: columns }, () => []);
  items.forEach((item, index) => result[index % columns].push(item));
  return result;
};

export const useMasonryColumns = (ref: RefObject<HTMLElement | null>): number => {
  const [columns, setColumns] = useState(1);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setColumns(masonryColumnCount(el.clientWidth));
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width !== undefined) setColumns(masonryColumnCount(width));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);

  return columns;
};
