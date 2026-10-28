/**
 * Automatic dock tab cleanup: which content tabs to close because they sat
 * unused too long, or because the strip grew past its cap. A workspace gets
 * the full cleanup on its first visit after launch; later, opening a tab
 * enforces only the cap, and switching workspaces closes nothing.
 *
 * Pure rules over `DockState` and per-tab last-use times; `DockStore` runs
 * the closes through `store.close`, so closed web tabs stay reopenable.
 */
import type { DockPreviewTab, DockState } from '../state/dock-types';

/** Content tabs unused this long are closed. */
export const IDLE_TAB_MS = 3 * 24 * 60 * 60_000;

/** Most content tabs a workspace keeps open; past it the least recently used close. */
export const DOCK_TAB_LIMIT = 20;

type CleanupState = Pick<DockState, 'tabs' | 'activeTabId' | 'splitTabIds'>;

/**
 * Folder tabs can hold an unsaved draft and MCP App tabs hold live app state,
 * so only tabs that are cheap to get back are closed automatically. Web tabs
 * go to the reopen stack; the others reopen from their canvas or library.
 */
const AUTO_CLOSE_KINDS = new Set<DockPreviewTab['kind']>(['link', 'node-detail', 'artifact', 'canvas', 'skill']);

/** Tabs on screen (the active tab or a split pane) and pinned tabs are never closed. */
const canAutoClose = (tab: DockPreviewTab, state: CleanupState): boolean => (
  AUTO_CLOSE_KINDS.has(tab.kind)
  && !tab.pinned
  && tab.id !== state.activeTabId
  && !state.splitTabIds?.includes(tab.id)
);

/**
 * Tabs not used within `IDLE_TAB_MS`. A tab without a recorded time is
 * treated as fresh, so sessions saved before tracking existed are kept.
 */
export function idleTabIds(
  lastActiveAt: Readonly<Record<string, number>>,
  state: CleanupState,
  now: number,
): string[] {
  return state.tabs
    .filter((tab) => canAutoClose(tab, state) && now - (lastActiveAt[tab.id] ?? now) >= IDLE_TAB_MS)
    .map((tab) => tab.id);
}

/**
 * Least recently used tabs to close so at most `limit` content tabs stay
 * open. Equal times close left to right. When too few tabs may close, the
 * strip stays over the cap rather than closing a protected tab.
 */
export function overflowTabIds(
  lastActiveAt: Readonly<Record<string, number>>,
  state: CleanupState,
  limit = DOCK_TAB_LIMIT,
): string[] {
  const excess = state.tabs.length - limit;
  if (excess <= 0) return [];
  return state.tabs
    .filter((tab) => canAutoClose(tab, state))
    .map((tab, index) => ({ id: tab.id, index, usedAt: lastActiveAt[tab.id] ?? Number.POSITIVE_INFINITY }))
    .sort((a, b) => a.usedAt - b.usedAt || a.index - b.index)
    .slice(0, excess)
    .map((entry) => entry.id);
}

/** Idle tabs first, then the oldest of the rest until the strip fits the cap. */
export function staleTabIds(
  lastActiveAt: Readonly<Record<string, number>>,
  state: CleanupState,
  now: number,
): string[] {
  const idle = idleTabIds(lastActiveAt, state, now);
  const remaining = { ...state, tabs: state.tabs.filter((tab) => !idle.includes(tab.id)) };
  return [...idle, ...overflowTabIds(lastActiveAt, remaining)];
}

/** Runs `staleTabIds` once per workspace per app launch, on its first visit. */
export class FirstVisitTabCleanup {
  private readonly cleanedWorkspaceIds = new Set<string>();

  staleTabIds(
    workspaceId: string,
    lastActiveAt: Readonly<Record<string, number>>,
    state: CleanupState,
    now: number,
  ): string[] {
    if (this.cleanedWorkspaceIds.has(workspaceId)) return [];
    this.cleanedWorkspaceIds.add(workspaceId);
    return staleTabIds(lastActiveAt, state, now);
  }
}
