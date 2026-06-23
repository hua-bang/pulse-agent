import { useEffect, useState } from 'react';

export const useMountedWorkspaceIds = (
  activeWorkspaceId: string,
  workspaces?: ReadonlyArray<{ id: string }>,
) => {
  const [mountedWorkspaceIds, setMountedWorkspaceIds] = useState<Set<string>>(
    () => (activeWorkspaceId ? new Set([activeWorkspaceId]) : new Set()),
  );

  useEffect(() => {
    if (!activeWorkspaceId) return;
    setMountedWorkspaceIds((prev) => {
      if (prev.has(activeWorkspaceId)) return prev;
      const next = new Set(prev);
      next.add(activeWorkspaceId);
      return next;
    });
  }, [activeWorkspaceId]);

  // Unmount workspaces that no longer exist so their canvases and chat panels
  // tear down and stop holding onto state after deletion.
  useEffect(() => {
    if (!workspaces) return;
    const valid = new Set(workspaces.map((w) => w.id));
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
