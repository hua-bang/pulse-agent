import { useCallback, useEffect, useState } from 'react';
import { useRailExpanded } from './useShellNavigation';

/** Match `--sidebar-collapsed` (rail) and `--sidebar-width` (rail + panel) in styles.css and `.sidebar--rail-expanded`. */
const SIDEBAR_PANEL_WIDTH = 224;
const SIDEBAR_RAIL_WIDTH = 48;
const SIDEBAR_RAIL_EXPANDED_WIDTH = 240;
/** Narrowest canvas strip still worth working in beside the dock. */
const MIN_CANVAS_WIDTH = 480;
/** Below this window width the labelled rail shows as the icon rail. */
const NARROW_WINDOW_WIDTH = 1100;

const readDockInset = (): number => (
  Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--right-dock-inset')) || 0
);

/**
 * True when the open dock would leave the canvas narrower than
 * `MIN_CANVAS_WIDTH` if the side panel (`panelWidth`) stayed open next to
 * the rail (`railWidth`).
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

/** True while the window is narrower than `NARROW_WINDOW_WIDTH`. */
export const useNarrowWindow = (): boolean => {
  const read = () => typeof window !== 'undefined' && window.innerWidth < NARROW_WINDOW_WIDTH;
  const [narrow, setNarrow] = useState(read);
  useEffect(() => {
    const update = () => setNarrow(read());
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return narrow;
};

interface SidebarLayoutInput {
  /** The route and the user's own collapse setting want the side panel. */
  panelRequested: boolean;
}

/**
 * Sidebar geometry: whether the rail shows labels, whether the side panel
 * shows, and the total width the rail and panel take.
 *
 * A narrow window shows the icon rail, so the 240px labels do not take half
 * of a 900px window; the toggle then expands it for this session only and
 * the saved preference stays as it was. The panel also hides for as long as
 * the dock needs the room, without touching the user's collapse setting, so
 * closing the dock brings it back.
 */
export const useSidebarLayout = ({ panelRequested }: SidebarLayoutInput) => {
  const [railExpanded, onToggleRail] = useRailExpanded();
  const narrowWindow = useNarrowWindow();
  const [expandedWhileNarrow, setExpandedWhileNarrow] = useState(false);
  useEffect(() => {
    if (!narrowWindow) setExpandedWhileNarrow(false);
  }, [narrowWindow]);
  const railShownExpanded = narrowWindow ? expandedWhileNarrow : railExpanded;
  const toggleRail = useCallback(() => {
    if (narrowWindow) setExpandedWhileNarrow((value) => !value);
    else onToggleRail();
  }, [narrowWindow, onToggleRail]);

  const railWidth = railShownExpanded ? SIDEBAR_RAIL_EXPANDED_WIDTH : SIDEBAR_RAIL_WIDTH;
  const dockSqueezesPanel = useDockSqueezesPanel(railWidth, SIDEBAR_PANEL_WIDTH);
  const panelHidden = !panelRequested || dockSqueezesPanel;
  return {
    railExpanded: railShownExpanded,
    toggleRail,
    panelHidden,
    width: railWidth + (panelHidden ? 0 : SIDEBAR_PANEL_WIDTH),
  };
};
