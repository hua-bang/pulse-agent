import type { DockLinkSession, DockLinkSessions, DockLinkTab, DockSessionPersistence } from './dock-link-sessions';

export const DOCK_SESSION_STORAGE_KEY = 'pulse-canvas.right-dock-link-sessions';
const SESSION_VERSION = 1;
const MAX_WORKSPACES = 100;
const MAX_TABS_PER_WORKSPACE = 50;

interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const parseLinkTab = (value: unknown): DockLinkTab | null => {
  if (!isRecord(value)) return null;
  if (
    value.kind !== 'link'
    || typeof value.id !== 'string'
    || typeof value.title !== 'string'
    || typeof value.url !== 'string'
  ) {
    return null;
  }
  return {
    id: value.id,
    kind: 'link',
    title: value.title,
    url: value.url,
    ...(typeof value.faviconUrl === 'string' ? { faviconUrl: value.faviconUrl } : {}),
  };
};

const parseSession = (value: unknown): DockLinkSession | null => {
  if (!isRecord(value) || !Array.isArray(value.tabs)) return null;
  const tabs = value.tabs.slice(0, MAX_TABS_PER_WORKSPACE).flatMap((tab) => {
    const parsed = parseLinkTab(tab);
    return parsed ? [parsed] : [];
  });
  const requestedActiveId = typeof value.activeTabId === 'string' ? value.activeTabId : undefined;
  const activeTabId = requestedActiveId && tabs.some((tab) => tab.id === requestedActiveId)
    ? requestedActiveId
    : undefined;
  return { tabs, activeTabId };
};

const parseSessions = (value: unknown): DockLinkSessions => {
  if (!isRecord(value) || value.version !== SESSION_VERSION || !isRecord(value.sessions)) return {};
  const sessions: DockLinkSessions = {};
  for (const [workspaceId, rawSession] of Object.entries(value.sessions).slice(0, MAX_WORKSPACES)) {
    if (!workspaceId) continue;
    const session = parseSession(rawSession);
    if (session) sessions[workspaceId] = session;
  }
  return sessions;
};

export const createDockSessionPersistence = (storage: StorageLike): DockSessionPersistence => ({
  load: () => {
    try {
      const raw = storage.getItem(DOCK_SESSION_STORAGE_KEY);
      return raw ? parseSessions(JSON.parse(raw)) : {};
    } catch {
      return {};
    }
  },
  save: (sessions) => {
    storage.setItem(DOCK_SESSION_STORAGE_KEY, JSON.stringify({
      version: SESSION_VERSION,
      sessions,
    }));
  },
});
