import { useEffect, useState } from 'react';

export const useMountedWorkspaceIds = (activeWorkspaceId: string) => {
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

  return mountedWorkspaceIds;
};
