/**
 * Saves dock terminal tabs per workspace, so a restart brings the tabs back.
 * The shell process does not survive a restart: a restored tab spawns a fresh
 * shell in its last known folder when the user opens it. A coding agent that
 * ran in the old shell is gone, so `agentType` is not restored.
 */
import type { DockTerminalTab, DockTerminalWorkspaceState } from './dock-types';

export const DOCK_TERMINAL_STORAGE_KEY = 'pulse-canvas.right-dock-terminals';
const TERMINAL_STORAGE_VERSION = 1;
const MAX_WORKSPACES = 100;
const MAX_TABS_PER_WORKSPACE = 50;

export type DockTerminalWorkspaces = Record<string, DockTerminalWorkspaceState>;

export interface DockTerminalPersistence {
  load: () => DockTerminalWorkspaces;
  save: (workspaces: DockTerminalWorkspaces) => void;
}

interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const parseTab = (value: unknown): DockTerminalTab | null => {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || !value.id) return null;
  if (typeof value.ordinal !== 'number' || !Number.isInteger(value.ordinal) || value.ordinal < 1) return null;
  return {
    id: value.id,
    ordinal: value.ordinal,
    ...(typeof value.title === 'string' && value.title.trim() ? { title: value.title } : {}),
    ...(typeof value.cwd === 'string' && value.cwd ? { cwd: value.cwd } : {}),
  };
};

const parseWorkspace = (value: unknown): DockTerminalWorkspaceState | null => {
  if (!isRecord(value) || !Array.isArray(value.tabs)) return null;
  const seen = new Set<string>();
  const tabs = value.tabs.slice(0, MAX_TABS_PER_WORKSPACE).flatMap((raw) => {
    const tab = parseTab(raw);
    if (!tab || seen.has(tab.id)) return [];
    seen.add(tab.id);
    return [tab];
  });
  if (tabs.length === 0) return null;
  const highestOrdinal = Math.max(...tabs.map((tab) => tab.ordinal));
  // Never hand out an ordinal (and so a tab id) that a restored tab still uses.
  const nextOrdinal = typeof value.nextOrdinal === 'number' && value.nextOrdinal > highestOrdinal
    ? Math.floor(value.nextOrdinal)
    : highestOrdinal + 1;
  const activeTabId = typeof value.activeTabId === 'string' && seen.has(value.activeTabId)
    ? value.activeTabId
    : undefined;
  return { tabs, activeTabId, nextOrdinal };
};

const parseWorkspaces = (value: unknown): DockTerminalWorkspaces => {
  if (!isRecord(value) || value.version !== TERMINAL_STORAGE_VERSION || !isRecord(value.workspaces)) return {};
  const workspaces: DockTerminalWorkspaces = {};
  for (const [workspaceId, raw] of Object.entries(value.workspaces).slice(0, MAX_WORKSPACES)) {
    if (!workspaceId) continue;
    const workspace = parseWorkspace(raw);
    if (workspace) workspaces[workspaceId] = workspace;
  }
  return workspaces;
};

const toStored = (workspace: DockTerminalWorkspaceState): DockTerminalWorkspaceState => ({
  ...workspace,
  tabs: workspace.tabs.map(({ agentType: _agentType, ...tab }) => tab),
});

export const createDockTerminalPersistence = (storage: StorageLike): DockTerminalPersistence => ({
  load: () => {
    try {
      const raw = storage.getItem(DOCK_TERMINAL_STORAGE_KEY);
      return raw ? parseWorkspaces(JSON.parse(raw)) : {};
    } catch {
      return {};
    }
  },
  save: (workspaces) => {
    try {
      storage.setItem(DOCK_TERMINAL_STORAGE_KEY, JSON.stringify({
        version: TERMINAL_STORAGE_VERSION,
        workspaces: Object.fromEntries(Object.entries(workspaces).map(([id, workspace]) => [id, toStored(workspace)])),
      }));
    } catch {
      // Restoration is best-effort; unavailable storage must not break the dock.
    }
  },
});
