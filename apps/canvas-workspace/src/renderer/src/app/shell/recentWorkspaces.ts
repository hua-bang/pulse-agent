const RECENT_WORKSPACES_KEY = 'pulse-canvas.recent-workspaces';
const RECENT_LIMIT = 20;

/** Workspace ids, most recently opened first. Best-effort local storage. */
export const readRecentWorkspaceIds = (): string[] => {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(RECENT_WORKSPACES_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
};

export const recordRecentWorkspace = (id: string): void => {
  const ids = [id, ...readRecentWorkspaceIds().filter((existing) => existing !== id)].slice(0, RECENT_LIMIT);
  try {
    window.localStorage.setItem(RECENT_WORKSPACES_KEY, JSON.stringify(ids));
  } catch {
    // Recency is best-effort only.
  }
};
