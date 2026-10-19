import { useCallback, useRef, useState } from 'react';
import type { SettingsSection } from '../../modules/settings';
import { APP_ROUTES } from './routeModel';

const SIDEBAR_COLLAPSED_KEY = 'pulse-canvas.sidebar-collapsed';
const RAIL_EXPANDED_KEY = 'pulse-canvas.rail-expanded';

/** A boolean shell preference kept in localStorage; `fallback` when unset or unreadable. */
const usePersistedToggle = (key: string, fallback = false) => {
  const [on, setOn] = useState(() => {
    try {
      const stored = window.localStorage.getItem(key);
      return stored === null ? fallback : stored === '1';
    } catch {
      return fallback;
    }
  });
  const toggle = useCallback(() => {
    setOn((value) => {
      try {
        window.localStorage.setItem(key, value ? '0' : '1');
      } catch {
        // Preference persistence is best-effort only.
      }
      return !value;
    });
  }, [key]);
  return [on, toggle] as const;
};

/** Persisted open/closed state of the sidebar panel next to the app rail. */
export const useSidebarCollapsed = () => usePersistedToggle(SIDEBAR_COLLAPSED_KEY);

/**
 * Persisted choice to show the app rail wide, with a label beside each icon.
 * Wide by default, because the workspace list only shows in the wide rail.
 */
export const useRailExpanded = () => usePersistedToggle(RAIL_EXPANDED_KEY, true);

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
