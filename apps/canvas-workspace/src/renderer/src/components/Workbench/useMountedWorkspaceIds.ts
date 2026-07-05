import { useEffect, useRef, useState } from 'react';

/** Background (non-active) workspaces kept mounted before LRU eviction
 *  kicks in. Each mounted workspace holds a full Canvas instance (nodes/
 *  edges state, undo history, tiptap editors, chat panel) — H1 finding:
 *  visiting N workspaces in a session otherwise keeps N of these alive
 *  forever (measured ~12.8MB/workspace heap slope, ws-cycle scenario). */
const MAX_BACKGROUND_WORKSPACES = 3;

interface TerminalPresence {
  tabs: unknown[];
}

export const useMountedWorkspaceIds = (
  activeWorkspaceId: string,
  workspaces?: ReadonlyArray<{ id: string }>,
  /** Workspace ids with ≥1 open terminal tab. Exempt from eviction —
   *  WorkspaceTerminalDock's unmount effect calls the pty `kill` IPC, so
   *  evicting a workspace with a live terminal would silently terminate
   *  whatever process the user has running in it (e.g. a dev server). */
  terminalTabsByWorkspace?: Record<string, TerminalPresence>,
) => {
  const [mountedWorkspaceIds, setMountedWorkspaceIds] = useState<Set<string>>(
    () => (activeWorkspaceId ? new Set([activeWorkspaceId]) : new Set()),
  );
  // Recency order, most-recently-active first. Drives which background
  // workspace(s) get evicted once more than MAX_BACKGROUND_WORKSPACES have
  // accumulated.
  const recencyRef = useRef<string[]>(activeWorkspaceId ? [activeWorkspaceId] : []);

  useEffect(() => {
    if (!activeWorkspaceId) return;
    recencyRef.current = [
      activeWorkspaceId,
      ...recencyRef.current.filter((id) => id !== activeWorkspaceId),
    ];

    setMountedWorkspaceIds((prev) => {
      const next = new Set(prev);
      next.add(activeWorkspaceId);

      let keptBackground = 0;
      for (const id of recencyRef.current) {
        if (id === activeWorkspaceId) continue;
        if ((terminalTabsByWorkspace?.[id]?.tabs.length ?? 0) > 0) continue;
        keptBackground += 1;
        if (keptBackground > MAX_BACKGROUND_WORKSPACES) next.delete(id);
      }

      if (next.size === prev.size && [...next].every((id) => prev.has(id))) return prev;
      return next;
    });
  }, [activeWorkspaceId, terminalTabsByWorkspace]);

  // Unmount workspaces that no longer exist so their canvases and chat panels
  // tear down and stop holding onto state after deletion.
  useEffect(() => {
    if (!workspaces) return;
    const valid = new Set(workspaces.map((w) => w.id));
    recencyRef.current = recencyRef.current.filter((id) => valid.has(id));
    setMountedWorkspaceIds((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (valid.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [workspaces]);

  return mountedWorkspaceIds;
};
