import { useCallback, useEffect, useState } from 'react';
import { useRailExpanded } from './useShellNavigation';

/** Match `--sidebar-collapsed` (rail) and `--sidebar-width` (rail + panel) in styles.css and `.sidebar--rail-expanded`. */
const SIDEBAR_PANEL_WIDTH = 224;
const SIDEBAR_RAIL_WIDTH = 48;
const SIDEBAR_RAIL_EXPANDED_WIDTH = 240;
/** Narrowest canvas strip still worth working in beside the dock. */
const MIN_CANVAS_WIDTH = 480;
/** Narrowest canvas strip that still justifies keeping the 240px labelled rail open beside the dock. */
const MIN_CANVAS_WIDTH_FOR_EXPANDED_RAIL = 680;
/** Below this window width the labelled rail shows as the icon rail. */
const NARROW_WINDOW_WIDTH = 1100;

const readDockInset = (): number => (
  Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--right-dock-inset')) || 0
);

const useViewportMetrics = (): { windowWidth: number; dockInset: number } => {
  const read = () => ({
    windowWidth: typeof window !== 'undefined' ? window.innerWidth : 0,
    dockInset: typeof document !== 'undefined' ? readDockInset() : 0,
  });
  const [metrics, setMetrics] = useState(read);

  useEffect(() => {
    const update = () => {
      const next = read();
      setMetrics((prev) => (
        prev.windowWidth === next.windowWidth && prev.dockInset === next.dockInset ? prev : next
      ));
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);

  return metrics;
};

/**
 * True when the open dock would leave the canvas narrower than
 * `MIN_CANVAS_WIDTH` if the side panel (`panelWidth`) stayed open next to
 * the rail (`railWidth`).
 *
 * The dock publishes its reserved width as `--right-dock-inset` on the root
 * element, so this watches that style and the window width.
 */
export const useDockSqueezesPanel = (railWidth: number, panelWidth: number): boolean => {
  const { windowWidth, dockInset } = useViewportMetrics();
  return dockInset > 0 && windowWidth - railWidth - panelWidth - dockInset < MIN_CANVAS_WIDTH;
};

/** True while the window is narrower than `NARROW_WINDOW_WIDTH`. */
export const useNarrowWindow = (): boolean => {
  const { windowWidth } = useViewportMetrics();
  return windowWidth > 0 && windowWidth < NARROW_WINDOW_WIDTH;
};

interface SidebarLayoutInput {
  /** The route and the user's own collapse setting want the side panel. */
  panelRequested: boolean;
}

/**
 * Sidebar geometry: whether the rail shows labels, whether the side panel
 * shows, and the total width the rail and panel take.
 *
 * A narrow window or an open dock that crowds the canvas temporarily shows
 * the 48px icon rail so the 240px labels do not starve the canvas; the toggle
 * then expands it for this session only and the saved preference stays as it
 * was. Closing the dock or widening the window restores the saved preference.
 * The side panel also hides for as long as the dock needs the room, without
 * touching the user's collapse setting, so closing the dock brings it back.
 */
export const useSidebarLayout = ({ panelRequested }: SidebarLayoutInput) => {
  const [railExpanded, onToggleRail] = useRailExpanded();
  const { windowWidth, dockInset } = useViewportMetrics();
  const narrowWindow = windowWidth > 0 && windowWidth < NARROW_WINDOW_WIDTH;
  const dockSqueezesRail = dockInset > 0
    && windowWidth - SIDEBAR_RAIL_EXPANDED_WIDTH - dockInset < MIN_CANVAS_WIDTH_FOR_EXPANDED_RAIL;
  const railConstrained = narrowWindow || dockSqueezesRail;
  const [expandedWhileConstrained, setExpandedWhileConstrained] = useState(false);
  useEffect(() => {
    if (!railConstrained) setExpandedWhileConstrained(false);
  }, [railConstrained]);
  const railShownExpanded = railConstrained ? expandedWhileConstrained : railExpanded;
  const toggleRail = useCallback(() => {
    if (railConstrained) setExpandedWhileConstrained((value) => !value);
    else onToggleRail();
  }, [railConstrained, onToggleRail]);

  const railWidth = railShownExpanded ? SIDEBAR_RAIL_EXPANDED_WIDTH : SIDEBAR_RAIL_WIDTH;
  const dockSqueezesPanel = dockInset > 0
    && windowWidth - railWidth - SIDEBAR_PANEL_WIDTH - dockInset < MIN_CANVAS_WIDTH;
  const panelHidden = !panelRequested || dockSqueezesPanel;
  return {
    railExpanded: railShownExpanded,
    toggleRail,
    panelHidden,
    width: railWidth + (panelHidden ? 0 : SIDEBAR_PANEL_WIDTH),
  };
};
