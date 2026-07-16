import { useEffect, useRef } from 'react';
import type { CanvasNode } from '../../types';
import { PREVIEW_NODE_ACTION_EVENT, type PreviewNodeActionDetail } from '../../utils/openNodeBridge';

interface Options {
  activeWorkspaceId: string;
  /** Insert a cross-workspace mention into the active workspace's composer. */
  addPreviewNodeToChat: (activeWorkspaceId: string, sourceWorkspaceId: string, node: CanvasNode) => void;
  /** Pin a node into the active workspace's reference panel. */
  pinReferenceNode: (workspaceId: string, nodeId: string, sourceNode?: CanvasNode) => void;
  ensureWorkspaceNodesLoaded: (workspaceId: string) => void;
}

/**
 * Routes header-button actions fired from the read-only dock canvas preview
 * (see CanvasPreview) to the Workbench-owned chat composer and reference
 * panel. A window-event bridge, same pattern as OPEN_NODE_EVENT: the preview
 * lives in the RightDock tree, so threading callbacks down would couple the
 * dock to Workbench internals.
 */
export function usePreviewNodeActionBridge(options: Options): void {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<PreviewNodeActionDetail<CanvasNode>>).detail;
      if (!detail?.node?.id || !detail.workspaceId) return;
      const { activeWorkspaceId, addPreviewNodeToChat, pinReferenceNode, ensureWorkspaceNodesLoaded } = optionsRef.current;
      // Keep the previewed workspace's snapshot warm so reference resolution
      // and mention focus can find the node without another disk read.
      ensureWorkspaceNodesLoaded(detail.workspaceId);
      if (detail.action === 'add-to-chat') {
        addPreviewNodeToChat(activeWorkspaceId, detail.workspaceId, detail.node);
      } else if (detail.action === 'pin-reference') {
        pinReferenceNode(detail.workspaceId, detail.node.id, detail.node);
      }
    };
    window.addEventListener(PREVIEW_NODE_ACTION_EVENT, handler);
    return () => window.removeEventListener(PREVIEW_NODE_ACTION_EVENT, handler);
  }, []);
}
