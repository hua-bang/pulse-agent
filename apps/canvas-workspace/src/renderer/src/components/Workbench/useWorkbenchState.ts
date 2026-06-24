import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CanvasNode } from '../../types';
import type { CanvasNodeRenameRequest } from '../../types/ui-interaction';
import { OPEN_NODE_EVENT, type OpenNodeDetail } from '../../utils/openNodeBridge';

interface WorkbenchNodeRequest {
  workspaceId: string;
  nodeId: string;
}

interface UseWorkbenchStateOptions {
  activeWorkspaceId: string;
  workspaces: ReadonlyArray<{ id: string }>;
}

export interface WorkbenchController {
  allNodes: Record<string, CanvasNode[]>;
  activeNodes: CanvasNode[];
  activeSelectedNode: CanvasNode | undefined;
  selectedNodeIdsByWorkspace: Record<string, string[]>;
  focusRequest: WorkbenchNodeRequest | undefined;
  deleteRequest: WorkbenchNodeRequest | undefined;
  renameRequest: CanvasNodeRenameRequest | undefined;
  ensureWorkspaceNodesLoaded: (workspaceId: string) => void;
  getWorkspaceNodes: (workspaceId: string) => CanvasNode[];
  handleNodesChange: (workspaceId: string, nodes: CanvasNode[]) => void;
  patchNodeSnapshot: (workspaceId: string, nodeId: string, patch: Partial<CanvasNode>) => CanvasNode[] | undefined;
  handleSelectionChange: (workspaceId: string, selectedNodeIds: string[]) => void;
  requestNodeFocus: (workspaceId: string, nodeId: string) => void;
  requestActiveNodeFocus: (nodeId: string) => void;
  requestActiveNodeDelete: (nodeId: string) => void;
  requestActiveNodeRename: (nodeId: string, title: string) => void;
  clearFocusRequest: () => void;
  clearDeleteRequest: () => void;
  clearRenameRequest: () => void;
}

const EMPTY_NODES: CanvasNode[] = [];
const EMPTY_NODE_IDS: string[] = [];

const hasWorkspaceSnapshot = (
  snapshots: Record<string, CanvasNode[]>,
  workspaceId: string,
) => Object.prototype.hasOwnProperty.call(snapshots, workspaceId);

export function useWorkbenchState({
  activeWorkspaceId,
  workspaces,
}: UseWorkbenchStateOptions): WorkbenchController {
  const [allNodes, setAllNodes] = useState<Record<string, CanvasNode[]>>({});
  const [selectedNodeIdsByWorkspace, setSelectedNodeIdsByWorkspace] = useState<Record<string, string[]>>({});
  const [focusRequest, setFocusRequest] = useState<WorkbenchNodeRequest | undefined>();
  const [deleteRequest, setDeleteRequest] = useState<WorkbenchNodeRequest | undefined>();
  const [renameRequest, setRenameRequest] = useState<CanvasNodeRenameRequest | undefined>();

  const allNodesRef = useRef(allNodes);
  allNodesRef.current = allNodes;

  // Drop cached state for workspaces that no longer exist (e.g. after a
  // deletion) so their node snapshots and selections don't linger in memory.
  useEffect(() => {
    const valid = new Set(workspaces.map((w) => w.id));
    setAllNodes((prev) => {
      const keys = Object.keys(prev);
      if (keys.every((key) => valid.has(key))) return prev;
      const next: Record<string, CanvasNode[]> = {};
      for (const key of keys) if (valid.has(key)) next[key] = prev[key];
      return next;
    });
    setSelectedNodeIdsByWorkspace((prev) => {
      const keys = Object.keys(prev);
      if (keys.every((key) => valid.has(key))) return prev;
      const next: Record<string, string[]> = {};
      for (const key of keys) if (valid.has(key)) next[key] = prev[key];
      return next;
    });
  }, [workspaces]);

  const ensureWorkspaceNodesLoaded = useCallback((workspaceId: string) => {
    if (hasWorkspaceSnapshot(allNodesRef.current, workspaceId)) return;
    const api = window.canvasWorkspace?.store;
    if (!api) return;

    void api.load(workspaceId).then((result) => {
      if (!result.ok || !result.data) return;
      const nodes = Array.isArray(result.data.nodes) ? result.data.nodes : [];
      setAllNodes((prev) => {
        if (hasWorkspaceSnapshot(prev, workspaceId)) return prev;
        return { ...prev, [workspaceId]: nodes };
      });
    });
  }, []);

  const getWorkspaceNodes = useCallback((workspaceId: string) => {
    return allNodesRef.current[workspaceId] ?? EMPTY_NODES;
  }, []);

  const handleNodesChange = useCallback((workspaceId: string, nodes: CanvasNode[]) => {
    allNodesRef.current = { ...allNodesRef.current, [workspaceId]: nodes };
    setAllNodes((prev) => {
      if (prev[workspaceId] === nodes) return prev;
      return { ...prev, [workspaceId]: nodes };
    });
  }, []);

  const patchNodeSnapshot = useCallback((workspaceId: string, nodeId: string, patch: Partial<CanvasNode>) => {
    const current = allNodesRef.current[workspaceId];
    if (!current) return undefined;
    const now = Date.now();
    let changed = false;
    const next = current.map((node) => {
      if (node.id !== nodeId) return node;
      changed = true;
      return { ...node, ...patch, updatedAt: now };
    });
    if (!changed) return undefined;
    allNodesRef.current = { ...allNodesRef.current, [workspaceId]: next };
    setAllNodes(allNodesRef.current);
    return next;
  }, []);

  const handleSelectionChange = useCallback((workspaceId: string, selectedNodeIds: string[]) => {
    setSelectedNodeIdsByWorkspace((prev) => {
      const existing = prev[workspaceId] ?? EMPTY_NODE_IDS;
      if (
        existing.length === selectedNodeIds.length
        && existing.every((id, index) => id === selectedNodeIds[index])
      ) {
        return prev;
      }
      return { ...prev, [workspaceId]: selectedNodeIds };
    });
  }, []);

  const requestNodeFocus = useCallback((workspaceId: string, nodeId: string) => {
    ensureWorkspaceNodesLoaded(workspaceId);
    setFocusRequest({ workspaceId, nodeId });
  }, [ensureWorkspaceNodesLoaded]);

  // Note mentions (and other deep node links) dispatch OPEN_NODE_EVENT on the
  // window; focus the referenced node through the same request pipeline.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<OpenNodeDetail>).detail;
      if (!detail?.nodeId) return;
      requestNodeFocus(detail.workspaceId || activeWorkspaceId, detail.nodeId);
    };
    window.addEventListener(OPEN_NODE_EVENT, handler);
    return () => window.removeEventListener(OPEN_NODE_EVENT, handler);
  }, [activeWorkspaceId, requestNodeFocus]);

  const requestActiveNodeFocus = useCallback((nodeId: string) => {
    requestNodeFocus(activeWorkspaceId, nodeId);
  }, [activeWorkspaceId, requestNodeFocus]);

  const requestActiveNodeDelete = useCallback((nodeId: string) => {
    setDeleteRequest({ workspaceId: activeWorkspaceId, nodeId });
  }, [activeWorkspaceId]);

  const requestNodeRename = useCallback((workspaceId: string, nodeId: string, title: string) => {
    setRenameRequest({ workspaceId, nodeId, title });
  }, []);

  const requestActiveNodeRename = useCallback((nodeId: string, title: string) => {
    requestNodeRename(activeWorkspaceId, nodeId, title);
  }, [activeWorkspaceId, requestNodeRename]);

  const clearFocusRequest = useCallback(() => {
    setFocusRequest(undefined);
  }, []);

  const clearDeleteRequest = useCallback(() => {
    setDeleteRequest(undefined);
  }, []);

  const clearRenameRequest = useCallback(() => {
    setRenameRequest(undefined);
  }, []);

  const activeNodes = allNodes[activeWorkspaceId] ?? EMPTY_NODES;
  const activeSelectedNodeIds = selectedNodeIdsByWorkspace[activeWorkspaceId] ?? EMPTY_NODE_IDS;
  const activeSelectedNode = useMemo(() => {
    if (activeSelectedNodeIds.length !== 1) return undefined;
    return activeNodes.find((node) => node.id === activeSelectedNodeIds[0]);
  }, [activeNodes, activeSelectedNodeIds]);

  return {
    allNodes,
    activeNodes,
    activeSelectedNode,
    selectedNodeIdsByWorkspace,
    focusRequest,
    deleteRequest,
    renameRequest,
    ensureWorkspaceNodesLoaded,
    getWorkspaceNodes,
    handleNodesChange,
    patchNodeSnapshot,
    handleSelectionChange,
    requestNodeFocus,
    requestActiveNodeFocus,
    requestActiveNodeDelete,
    requestActiveNodeRename,
    clearFocusRequest,
    clearDeleteRequest,
    clearRenameRequest,
  };
}
