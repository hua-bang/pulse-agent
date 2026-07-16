import { useCallback, useEffect, useRef } from 'react';
import type { CanvasNode } from '../../types';
import type { NodeReferenceEntry } from '../ReferenceDrawer/types';
import { getNodeDisplayLabel } from '../../utils/nodeLabel';
import {
  PREVIEW_NODE_ACTION_EVENT,
  requestPreviewNodeFocus,
  type PreviewNodeActionDetail,
} from '../../utils/openNodeBridge';

interface Options {
  activeWorkspaceId: string;
  workspaces: ReadonlyArray<{ id: string; name: string }>;
  /** Insert a cross-workspace mention into the active workspace's composer. */
  addPreviewNodeToChat: (activeWorkspaceId: string, sourceWorkspaceId: string, node: CanvasNode) => void;
  /** Pin a node into the active workspace's reference panel. */
  pinReferenceNode: (workspaceId: string, nodeId: string, sourceNode?: CanvasNode) => void;
  /** Start the click-to-place flow that drops a reference node on the main canvas. */
  addReferenceToCanvas: (entry: NodeReferenceEntry) => void;
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
      const { activeWorkspaceId, workspaces, addPreviewNodeToChat, pinReferenceNode, addReferenceToCanvas, ensureWorkspaceNodesLoaded } = optionsRef.current;
      // Keep the previewed workspace's snapshot warm so reference resolution
      // and mention focus can find the node without another disk read.
      ensureWorkspaceNodesLoaded(detail.workspaceId);
      if (detail.action === 'add-to-chat') {
        addPreviewNodeToChat(activeWorkspaceId, detail.workspaceId, detail.node);
      } else if (detail.action === 'pin-reference') {
        pinReferenceNode(detail.workspaceId, detail.node.id, detail.node);
      } else if (detail.action === 'add-to-canvas') {
        addReferenceToCanvas({
          kind: 'node',
          workspaceId: detail.workspaceId,
          nodeId: detail.node.id,
          titleSnapshot: getNodeDisplayLabel(detail.node),
          typeSnapshot: detail.node.type,
          workspaceNameSnapshot: workspaces.find((ws) => ws.id === detail.workspaceId)?.name,
        });
      }
    };
    window.addEventListener(PREVIEW_NODE_ACTION_EVENT, handler);
    return () => window.removeEventListener(PREVIEW_NODE_ACTION_EVENT, handler);
  }, []);
}

interface PeekOptions {
  activeWorkspaceId: string;
  workspaces: ReadonlyArray<{ id: string; name: string }>;
  openCanvasPreview: (workspaceId: string, title: string) => boolean;
  onSelectWorkspace: (workspaceId: string) => void;
  requestNodeFocus: (workspaceId: string, nodeId: string) => void;
}

/**
 * Focus a node with the least disruptive surface available: the main canvas
 * when the node's workspace is active, otherwise a read-only dock preview
 * ("peek") so the user keeps their main canvas. Falls back to switching the
 * main canvas when the workspace can't be previewed (it is already live /
 * background-mounted in the Workbench — the one-writer invariant).
 */
export function usePeekNode(options: PeekOptions): (workspaceId: string, nodeId: string) => void {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  return useCallback((workspaceId: string, nodeId: string) => {
    const { activeWorkspaceId, workspaces, openCanvasPreview, onSelectWorkspace, requestNodeFocus } = optionsRef.current;
    if (workspaceId === activeWorkspaceId) {
      requestNodeFocus(workspaceId, nodeId);
      return;
    }
    const name = workspaces.find((ws) => ws.id === workspaceId)?.name ?? workspaceId;
    if (openCanvasPreview(workspaceId, name)) {
      requestPreviewNodeFocus(workspaceId, nodeId);
      return;
    }
    onSelectWorkspace(workspaceId);
    requestNodeFocus(workspaceId, nodeId);
  }, []);
}
