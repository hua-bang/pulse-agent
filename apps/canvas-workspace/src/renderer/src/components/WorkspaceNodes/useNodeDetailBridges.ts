import { useEffect } from 'react';
import {
  FOCUS_NODE_ON_CANVAS_EVENT,
  OPEN_NODE_PAGE_EVENT,
  type OpenNodeDetail,
} from '../../utils/openNodeBridge';

interface Options {
  activeWorkspaceId: string;
  enabled: boolean;
  /** Drill into the node's own page route. */
  openNodePage: (workspaceId: string, nodeId: string) => void;
  /** Leave the knowledge surfaces and frame the node on its canvas. */
  focusNodeOnCanvas: (workspaceId: string, nodeId: string) => void;
}

/**
 * Both directions of travel between Node Detail and the rest of the app.
 * Node Detail renders in two hosts (a page route and a dock tab), so neither
 * can own these callbacks; a window-event bridge keeps the shared panel free
 * of host-specific plumbing — the same pattern as OPEN_NODE_EVENT.
 */
export const useNodeDetailBridges = ({
  activeWorkspaceId,
  enabled,
  openNodePage,
  focusNodeOnCanvas,
}: Options) => {
  useEffect(() => {
    if (!enabled) return;
    const route = (
      handle: (workspaceId: string, nodeId: string) => void,
    ) => (event: Event) => {
      const detail = (event as CustomEvent<OpenNodeDetail>).detail;
      if (!detail?.nodeId) return;
      handle(detail.workspaceId || activeWorkspaceId, detail.nodeId);
    };
    const onOpenPage = route(openNodePage);
    const onFocusOnCanvas = route(focusNodeOnCanvas);
    window.addEventListener(OPEN_NODE_PAGE_EVENT, onOpenPage);
    window.addEventListener(FOCUS_NODE_ON_CANVAS_EVENT, onFocusOnCanvas);
    return () => {
      window.removeEventListener(OPEN_NODE_PAGE_EVENT, onOpenPage);
      window.removeEventListener(FOCUS_NODE_ON_CANVAS_EVENT, onFocusOnCanvas);
    };
  }, [activeWorkspaceId, enabled, focusNodeOnCanvas, openNodePage]);
};
