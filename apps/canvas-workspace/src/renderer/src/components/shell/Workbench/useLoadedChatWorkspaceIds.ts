import { useEffect, useState } from 'react';

export const useLoadedChatWorkspaceIds = (open: boolean, activeWorkspaceId: string): Set<string> => {
  const [loaded, setLoaded] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    if (!open || loaded.has(activeWorkspaceId)) return;
    setLoaded((current) => new Set(current).add(activeWorkspaceId));
  }, [activeWorkspaceId, loaded, open]);
  return loaded;
};
