import { useEffect, type MutableRefObject } from 'react';
import type { CanvasNode, CanvasTransform } from '../types';
import type { CanvasNodeRenameRequest } from '../types/ui-interaction';

interface Options {
  canvasId: string;
  loaded: boolean;
  nodes: CanvasNode[];
  transform: CanvasTransform;
  selectedNodeIds: string[];
  nodesRef: MutableRefObject<CanvasNode[]>;
  /** True while a node drag/resize is in flight. Used to defer the
   *  parent's `onNodesChange` callback so downstream consumers don't
   *  receive a stream of intermediate states; the final value is
   *  delivered when the gesture commits. */
  isDraggingRef: MutableRefObject<boolean>;
  pendingParentNodesRef: MutableRefObject<CanvasNode[] | null>;
  /** Shared with the `useNodes` saved-transform callback so loading a
   *  workspace with a persisted viewport skips the one-shot auto-fit. */
  hasAutoFittedRef: MutableRefObject<boolean>;
  setTransformForSave: (transform: CanvasTransform) => void;
  flushSave: () => void;
  fitAllNodes: (nodes: CanvasNode[]) => void;
  setSelectedNodeIds: (ids: string[]) => void;
  setHighlightedId: (id: string | null) => void;
  handleFocusNode: (node: CanvasNode) => void;
  updateNode: (id: string, patch: Partial<CanvasNode>) => void;
  handleExternalDelete: (deleteNodeId: string) => void;
  onNodesChange?: (canvasId: string, nodes: CanvasNode[]) => void;
  onSelectionChange?: (canvasId: string, selectedNodeIds: string[]) => void;
  focusNodeId?: string;
  onFocusComplete?: () => void;
  deleteNodeId?: string;
  onDeleteComplete?: () => void;
  renameRequest?: CanvasNodeRenameRequest;
  onRenameComplete?: () => void;
}

/**
 * Collects the canvas's lifecycle / parent-sync effects in one place:
 * flushing pending saves on unmount, persisting the viewport transform,
 * auto-fitting on first load, propagating nodes/selection to the parent
 * (with drag-pause), and consuming external focus / delete / rename
 * requests from the sidebar layers panel.
 */
export const useCanvasSyncEffects = ({
  canvasId,
  loaded,
  nodes,
  transform,
  selectedNodeIds,
  nodesRef,
  isDraggingRef,
  pendingParentNodesRef,
  hasAutoFittedRef,
  setTransformForSave,
  flushSave,
  fitAllNodes,
  setSelectedNodeIds,
  setHighlightedId,
  handleFocusNode,
  updateNode,
  handleExternalDelete,
  onNodesChange,
  onSelectionChange,
  focusNodeId,
  onFocusComplete,
  deleteNodeId,
  onDeleteComplete,
  renameRequest,
  onRenameComplete,
}: Options) => {
  // Flush pending saves on window close or component unmount
  useEffect(() => {
    const handler = () => { flushSave(); };
    window.addEventListener('beforeunload', handler);
    return () => {
      window.removeEventListener('beforeunload', handler);
      flushSave();
    };
  }, [flushSave]);

  // Only persist transform after data has loaded to avoid saving empty nodes
  useEffect(() => {
    if (!loaded) return;
    setTransformForSave(transform);
  }, [loaded, transform, setTransformForSave]);

  // Auto-fit all nodes into view on initial load
  useEffect(() => {
    if (loaded && !hasAutoFittedRef.current) {
      hasAutoFittedRef.current = true;
      if (nodes.length > 0) fitAllNodes(nodes);
    }
  }, [loaded, nodes, fitAllNodes, hasAutoFittedRef]);

  // Report nodes to parent only after loaded. While dragging, stash the
  // latest snapshot so the mouse-handlers hook can flush it once the
  // gesture ends.
  useEffect(() => {
    if (!loaded) return;
    if (isDraggingRef.current) {
      pendingParentNodesRef.current = nodes;
      return;
    }
    onNodesChange?.(canvasId, nodes);
  }, [canvasId, nodes, loaded, onNodesChange, isDraggingRef, pendingParentNodesRef]);

  // Report selection so adjacent UI, such as the Agent panel, can scope work
  // to the same nodes the user has visually selected.
  useEffect(() => {
    if (!loaded) return;
    onSelectionChange?.(canvasId, selectedNodeIds);
  }, [canvasId, loaded, onSelectionChange, selectedNodeIds]);

  // Handle external focus request (e.g. from sidebar layers panel)
  useEffect(() => {
    if (!loaded) return;
    if (!focusNodeId) return;
    const node = nodesRef.current.find((n) => n.id === focusNodeId);
    if (node) {
      setSelectedNodeIds([node.id]);
      setHighlightedId(node.id);
      handleFocusNode(node);
    }
    onFocusComplete?.();
  }, [focusNodeId, loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle external delete request (e.g. from sidebar layers context menu)
  useEffect(() => {
    if (!loaded) return;
    if (!deleteNodeId) return;
    handleExternalDelete(deleteNodeId);
    onDeleteComplete?.();
  }, [deleteNodeId, loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!loaded) return;
    if (!renameRequest) return;
    if (renameRequest.workspaceId !== canvasId) return;

    const node = nodesRef.current.find((item) => item.id === renameRequest.nodeId);
    if (node && node.title !== renameRequest.title) {
      updateNode(node.id, { title: renameRequest.title });
    }
    onRenameComplete?.();
  }, [renameRequest, loaded, canvasId, updateNode, onRenameComplete, nodesRef]);
};
