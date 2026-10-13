import { useCallback, useRef } from 'react';

interface Options {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  isDockExpanded: () => boolean;
  collapseDock: () => void;
  expandDock: () => void;
}

interface HiddenPanels {
  sidebar: boolean;
  dock: boolean;
}

/**
 * Focus mode for the workbench: one key hides the sidebar and the dock
 * together, and the next press shows the panels that were open before.
 * When both panels are already hidden and nothing is remembered, the key
 * shows both.
 */
export const usePanelsToggle = ({
  sidebarCollapsed,
  toggleSidebar,
  isDockExpanded,
  collapseDock,
  expandDock,
}: Options) => {
  const hiddenRef = useRef<HiddenPanels | null>(null);

  return useCallback(() => {
    const dockExpanded = isDockExpanded();
    if (sidebarCollapsed && !dockExpanded) {
      const restore = hiddenRef.current ?? { sidebar: true, dock: true };
      hiddenRef.current = null;
      if (restore.sidebar) toggleSidebar();
      if (restore.dock) expandDock();
      return;
    }
    hiddenRef.current = { sidebar: !sidebarCollapsed, dock: dockExpanded };
    if (!sidebarCollapsed) toggleSidebar();
    if (dockExpanded) collapseDock();
  }, [collapseDock, expandDock, isDockExpanded, sidebarCollapsed, toggleSidebar]);
};
