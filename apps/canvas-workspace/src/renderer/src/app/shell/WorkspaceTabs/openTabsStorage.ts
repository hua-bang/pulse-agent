/**
 * Persisted tab order for the workspace tab bar. Kept apart from the tab bar
 * component so the eager shortcut layer can read the order without loading
 * the lazy tab bar chunk.
 */
const OPEN_TABS_KEY = 'pulse-canvas.open-workspace-tabs';

export const readOpenTabs = (): string[] => {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(OPEN_TABS_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
};

export const writeOpenTabs = (ids: string[]): void => {
  try {
    window.localStorage.setItem(OPEN_TABS_KEY, JSON.stringify(ids));
  } catch {
    // Tab persistence is best-effort only.
  }
};

/**
 * Resolve Mod+1..9 to a workspace id. The order follows the open tabs, as in
 * a browser, and 9 always means the last tab. With no open tab, fall back to
 * the workspace list order.
 */
export const workspaceIdForTabIndex = (
  index: number,
  openTabIds: string[],
  workspaces: Array<{ id: string }>,
): string | null => {
  const known = new Set(workspaces.map((workspace) => workspace.id));
  const tabs = openTabIds.filter((id) => known.has(id));
  const order = tabs.length > 0 ? tabs : workspaces.map((workspace) => workspace.id);
  if (order.length === 0) return null;
  if (index === 9) return order[order.length - 1];
  return order[index - 1] ?? null;
};
