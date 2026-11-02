import { useCallback, useEffect, useRef, useState } from 'react';
import type { SettingsSection } from '../../modules/settings';
import { OPEN_APP_SETTINGS_EVENT } from '../../shared/appShell';
import { APP_ROUTES } from './routeModel';

const SIDEBAR_COLLAPSED_KEY = 'pulse-canvas.sidebar-collapsed';
const RAIL_EXPANDED_KEY = 'pulse-canvas.rail-expanded';
const PLUGIN_NAV_COLLAPSED_KEY = 'pulse-canvas.plugin-nav-collapsed';

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

/** Persisted open/closed state of the plugin group on the app rail. */
export const usePluginNavCollapsed = () => usePersistedToggle(PLUGIN_NAV_COLLAPSED_KEY);

interface SettingsNavigationOptions {
  location: string;
  activeView: string;
  setLocation: (path: string) => void;
}

/** The section that the rail gear, Cmd/Ctrl+, and the palette open. */
export const DEFAULT_SETTINGS_SECTION: SettingsSection = 'models';

/**
 * Settings is a route. Opening it remembers where the user came from, and
 * closing it goes back there. `requestOpenAppSettings` opens it at the
 * default section.
 */
export const useSettingsNavigation = ({ location, activeView, setLocation }: SettingsNavigationOptions) => {
  const returnPathRef = useRef<string | null>(null);

  const openAppSettings = useCallback((section: SettingsSection) => {
    if (activeView !== 'settings') returnPathRef.current = location;
    setLocation(`${APP_ROUTES.settings}?section=${encodeURIComponent(section)}`);
  }, [activeView, location, setLocation]);

  useEffect(() => {
    const handleOpen = () => openAppSettings(DEFAULT_SETTINGS_SECTION);
    window.addEventListener(OPEN_APP_SETTINGS_EVENT, handleOpen);
    return () => window.removeEventListener(OPEN_APP_SETTINGS_EVENT, handleOpen);
  }, [openAppSettings]);

  const closeAppSettings = useCallback(() => {
    const returnPath = returnPathRef.current;
    returnPathRef.current = null;
    setLocation(returnPath ?? APP_ROUTES.canvas);
  }, [setLocation]);

  return { openAppSettings, closeAppSettings };
};
