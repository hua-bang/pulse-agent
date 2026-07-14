import { useEffect } from 'react';
import { OPEN_NODE_PAGE_EVENT, type OpenNodeDetail } from '../../utils/openNodeBridge';

export const useOpenNodePageBridge = ({
  activeWorkspaceId,
  enabled,
  openNodePage,
}: {
  activeWorkspaceId: string;
  enabled: boolean;
  openNodePage: (workspaceId: string, nodeId: string) => void;
}) => {
  useEffect(() => {
    if (!enabled) return;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<OpenNodeDetail>).detail;
      if (!detail?.nodeId) return;
      openNodePage(detail.workspaceId || activeWorkspaceId, detail.nodeId);
    };
    window.addEventListener(OPEN_NODE_PAGE_EVENT, handler);
    return () => window.removeEventListener(OPEN_NODE_PAGE_EVENT, handler);
  }, [activeWorkspaceId, enabled, openNodePage]);
};
