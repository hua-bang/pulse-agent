import { useCallback, useEffect, useState } from 'react';
import type { WorkspaceEntry } from '../../../shared/workspaces';
import { recordRecentWorkspace } from '../recentWorkspaces';

const OPEN_TABS_KEY = 'pulse-canvas.open-workspace-tabs';

const readOpenTabs = (): string[] => {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(OPEN_TABS_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
};

const writeOpenTabs = (ids: string[]): void => {
  try {
    window.localStorage.setItem(OPEN_TABS_KEY, JSON.stringify(ids));
  } catch {
    // Tab persistence is best-effort only.
  }
};

/**
 * Which workspaces show as tabs above the canvas, in tab order. Becoming
 * active opens a tab; closing a tab never deletes the workspace.
 */
export const useOpenWorkspaceTabs = (workspaces: WorkspaceEntry[], activeId: string) => {
  const [openIds, setOpenIds] = useState<string[]>(readOpenTabs);

  const update = useCallback((next: (ids: string[]) => string[]) => {
    setOpenIds((ids) => {
      const result = next(ids);
      if (result === ids) return ids;
      writeOpenTabs(result);
      return result;
    });
  }, []);

  const open = useCallback((id: string) => {
    update((ids) => (ids.includes(id) ? ids : [...ids, id]));
  }, [update]);

  useEffect(() => {
    if (!activeId) return;
    open(activeId);
    recordRecentWorkspace(activeId);
  }, [activeId, open]);

  // Drop tabs whose workspace was deleted, once the list has loaded.
  useEffect(() => {
    if (workspaces.length === 0) return;
    const known = new Set(workspaces.map((ws) => ws.id));
    update((ids) => (ids.every((id) => known.has(id)) ? ids : ids.filter((id) => known.has(id))));
  }, [update, workspaces]);

  /** Closes a tab and returns the neighbour to show next, or null if none is left. */
  const close = useCallback((id: string): string | null => {
    const index = openIds.indexOf(id);
    if (index < 0) return null;
    const remaining = openIds.filter((openId) => openId !== id);
    update(() => remaining);
    return remaining[Math.min(index, remaining.length - 1)] ?? null;
  }, [openIds, update]);

  /** Keeps only this tab open. */
  const closeOthers = useCallback((id: string) => {
    update((ids) => (ids.length === 1 && ids[0] === id ? ids : [id]));
  }, [update]);

  return { openIds, close, closeOthers };
};
