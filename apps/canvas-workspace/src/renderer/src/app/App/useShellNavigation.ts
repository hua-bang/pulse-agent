import { useCallback, useRef, useState } from 'react';
import type { SettingsSection } from '../../modules/settings';
import { APP_ROUTES } from './routeModel';

const SIDEBAR_COLLAPSED_KEY = 'pulse-canvas.sidebar-collapsed';

const readSidebarCollapsedPreference = (): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    const stored = window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
    if (stored === '1') return true;
    if (stored === '0') return false;
  } catch {
    // localStorage may be unavailable; default to discoverability.
  }
  return false;
};

const writeSidebarCollapsedPreference = (collapsed: boolean): void => {
  try {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0');
  } catch {
    // Preference persistence is best-effort only.
  }
};

/** Persisted open/closed state of the sidebar panel next to the app rail. */
export const useSidebarCollapsed = () => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsedPreference);
  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((collapsed) => {
      const next = !collapsed;
      writeSidebarCollapsedPreference(next);
      return next;
    });
  }, []);
  return { sidebarCollapsed, toggleSidebar };
};

interface SettingsNavigationOptions {
  location: string;
  activeView: string;
  setLocation: (path: string) => void;
}

/**
 * Settings is a route. Opening it remembers where the user came from, and
 * closing it goes back there.
 */
export const useSettingsNavigation = ({ location, activeView, setLocation }: SettingsNavigationOptions) => {
  const returnPathRef = useRef<string | null>(null);

  const openAppSettings = useCallback((section: SettingsSection) => {
    if (activeView !== 'settings') returnPathRef.current = location;
    setLocation(`${APP_ROUTES.settings}?section=${encodeURIComponent(section)}`);
  }, [activeView, location, setLocation]);

  const closeAppSettings = useCallback(() => {
    const returnPath = returnPathRef.current;
    returnPathRef.current = null;
    setLocation(returnPath ?? APP_ROUTES.canvas);
  }, [setLocation]);

  return { openAppSettings, closeAppSettings };
};
