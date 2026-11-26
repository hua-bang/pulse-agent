import { useCallback, useEffect, useRef, useState } from 'react';
import type { SettingsSection } from '../../modules/settings';
import { OPEN_APP_SETTINGS_EVENT } from '../../shared/appShell';
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

/**
 * Owns the lazy workspace settings drawer state and the standalone
 * "Join Shared Canvas" dialog trigger across Sidebar, WorkspaceTabs, and Launcher.
 */
export const useWorkspaceSettingsSheet = () => {
  const [settingsWorkspaceId, setSettingsWorkspaceId] = useState<string | null>(null);
  const [workspaceSettingsLoaded, setWorkspaceSettingsLoaded] = useState(false);
  const [joinSharedOpen, setJoinSharedOpen] = useState(false);
  const [pendingJoinInvite, setPendingJoinInvite] = useState<string | undefined>(undefined);

  const openWorkspaceSettings = useCallback((workspaceId: string) => {
    setWorkspaceSettingsLoaded(true);
    setSettingsWorkspaceId(workspaceId);
  }, []);

  const closeWorkspaceSettings = useCallback(() => {
    setSettingsWorkspaceId(null);
  }, []);

  const openJoinShared = window.canvasWorkspace?.remoteVps
    ? () => {
        setPendingJoinInvite(undefined);
        setJoinSharedOpen(true);
      }
    : undefined;

  const closeJoinShared = useCallback(() => {
    setJoinSharedOpen(false);
    setPendingJoinInvite(undefined);
  }, []);

  useEffect(() => {
    const api = window.canvasWorkspace?.remoteVps;
    if (!api?.onJoinDeepLink) return;
    const handleInvite = (inviteCode: string) => {
      setPendingJoinInvite(inviteCode);
      setJoinSharedOpen(true);
    };
    const unsubscribe = api.onJoinDeepLink(handleInvite);
    void api.consumePendingJoinLinks?.().then((codes) => {
      if (codes.length > 0) handleInvite(codes[codes.length - 1]);
    });
    return unsubscribe;
  }, []);

  return {
    settingsWorkspaceId,
    workspaceSettingsLoaded,
    joinSharedOpen,
    pendingJoinInvite,
    openWorkspaceSettings,
    closeWorkspaceSettings,
    openJoinShared,
    closeJoinShared,
  };
};

interface CanvasQueryNavigationOptions {
  routePath: string;
  routeQuery: string;
  routeParams: URLSearchParams;
  redirectToCanvas: boolean;
  canvasRoute: string;
  activeId: string;
  hasWorkspace: (workspaceId: string) => boolean;
  selectWorkspace: (workspaceId: string) => void;
  requestNodeFocus: (workspaceId: string, nodeId: string) => void;
  setLocation: (path: string) => void;
}

/**
 * Handles `?workspaceId=&nodeId=` deep links onto the canvas route and bounces
 * disabled experimental routes back to the canvas.
 */
export const useCanvasQueryNavigation = ({
  routePath,
  routeQuery,
  routeParams,
  redirectToCanvas,
  canvasRoute,
  activeId,
  hasWorkspace,
  selectWorkspace,
  requestNodeFocus,
  setLocation,
}: CanvasQueryNavigationOptions) => {
  useEffect(() => {
    if (!routeQuery || routePath !== canvasRoute) return;

    const targetWorkspaceId = routeParams.get('workspaceId') ?? activeId;
    const targetNodeId = routeParams.get('nodeId');
    if (!targetWorkspaceId || !hasWorkspace(targetWorkspaceId)) return;

    if (activeId !== targetWorkspaceId) {
      selectWorkspace(targetWorkspaceId);
    }
    if (targetNodeId) {
      requestNodeFocus(targetWorkspaceId, targetNodeId);
    }
    setLocation(canvasRoute);
  }, [routePath, routeQuery, routeParams, canvasRoute, activeId, hasWorkspace, selectWorkspace, requestNodeFocus, setLocation]);

  useEffect(() => {
    if (redirectToCanvas) setLocation(canvasRoute);
  }, [redirectToCanvas, canvasRoute, setLocation]);
};


