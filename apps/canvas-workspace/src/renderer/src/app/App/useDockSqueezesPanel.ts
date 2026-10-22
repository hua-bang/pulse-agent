import { useEffect, useState } from 'react';

/** Narrowest canvas strip still worth working in beside the dock. */
const MIN_CANVAS_WIDTH = 480;

const readDockInset = (): number => (
  Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--right-dock-inset')) || 0
);

/**
 * True when the open dock would leave the canvas narrower than
 * `MIN_CANVAS_WIDTH` if the side panel (`panelWidth`) stayed open next to
 * the rail (`railWidth`). The shell then hides the panel for as long as the
 * dock needs the room, without touching the user's own collapse setting,
 * so closing the dock brings the panel back.
 *
 * The dock publishes its reserved width as `--right-dock-inset` on the root
 * element, so this watches that style and the window width.
 */
export const useDockSqueezesPanel = (railWidth: number, panelWidth: number): boolean => {
  const [squeezed, setSqueezed] = useState(false);

  useEffect(() => {
    const update = () => {
      const dockInset = readDockInset();
      setSqueezed(dockInset > 0 && window.innerWidth - railWidth - panelWidth - dockInset < MIN_CANVAS_WIDTH);
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [panelWidth, railWidth]);

  return squeezed;
};
