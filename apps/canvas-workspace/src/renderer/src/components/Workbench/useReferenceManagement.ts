import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createReferenceNodeDataSnapshot,
  type NodeReferenceEntryForCanvas,
  type ReferenceEntry,
} from '../ReferenceDrawer';
import type { WorkspaceEntry } from '../../hooks/useWorkspaces';
import type { CanvasNode, ReferenceNodeData } from '../../types';
import type { CanvasClipboard, CanvasNodePatchRequest } from '../../types/ui-interaction';
import { createDefaultNode } from '../../utils/nodeFactory';
import { getNodeDisplayLabel } from '../../utils/nodeLabel';
import { isReferenceableNode, isReferenceableNodeType } from '../../utils/referenceNodes';

const EMPTY_REFERENCES: ReferenceEntry[] = [];

interface UseReferenceManagementArgs {
  activeWorkspaceId: string;
  workspaces: WorkspaceEntry[];
  allNodes: Record<string, CanvasNode[]>;
  mountedWorkspaceIds: Set<string>;
  ensureWorkspaceNodesLoaded: (workspaceId: string) => void;
  requestNodeFocus: (workspaceId: string, nodeId: string) => void;
  onSelectWorkspace: (workspaceId: string) => void;
  patchNodeSnapshot: (workspaceId: string, nodeId: string, patch: Partial<CanvasNode>) => CanvasNode[] | undefined;
}

// Extracted from Workbench/index.tsx to keep it under the file-size gate;
// owns every piece of state and logic dedicated to the reference drawer /
// cross-workspace reference nodes.
export const useReferenceManagement = ({
  activeWorkspaceId,
  workspaces,
  allNodes,
  mountedWorkspaceIds,
  ensureWorkspaceNodesLoaded,
  requestNodeFocus,
  onSelectWorkspace,
  patchNodeSnapshot,
}: UseReferenceManagementArgs) => {
  const [referenceDrawerOpen, setReferenceDrawerOpen] = useState(false);
  const [referencesByWorkspace, setReferencesByWorkspace] = useState<Record<string, ReferenceEntry[]>>({});
  const [activeReferenceIdByWorkspace, setActiveReferenceIdByWorkspace] = useState<Record<string, string | undefined>>({});
  const [referencePlacementRequest, setReferencePlacementRequest] = useState<NodeReferenceEntryForCanvas | null>(null);
  const [nodePatchRequest, setNodePatchRequest] = useState<CanvasNodePatchRequest | undefined>();
  const patchRequestIdRef = useRef(0);

  const references = referencesByWorkspace[activeWorkspaceId] ?? EMPTY_REFERENCES;
  const activeReferenceId = activeReferenceIdByWorkspace[activeWorkspaceId];
  const activeReference = activeReferenceId
    ? references.find((entry) => (entry.kind === 'url' ? entry.id : `${entry.workspaceId}:${entry.nodeId}`) === activeReferenceId)
    : undefined;
  const activeReferenceNode = activeReference && activeReference.kind === 'node'
    ? (allNodes[activeReference.workspaceId] ?? []).find((node) => node.id === activeReference.nodeId)
    : undefined;

  const removeReference = useCallback((referenceId: string) => {
    setReferencesByWorkspace((prev) => {
      const current = prev[activeWorkspaceId] ?? [];
      const next = current.filter((entry) => (entry.kind === 'url' ? entry.id : `${entry.workspaceId}:${entry.nodeId}`) !== referenceId);
      if (next.length === current.length) return prev;
      return { ...prev, [activeWorkspaceId]: next };
    });
    setActiveReferenceIdByWorkspace((prev) => {
      if (prev[activeWorkspaceId] !== referenceId) return prev;
      return { ...prev, [activeWorkspaceId]: undefined };
    });
  }, [activeWorkspaceId]);

  const clearAllReferences = useCallback(() => {
    setReferencesByWorkspace((prev) => {
      if (!prev[activeWorkspaceId]?.length) return prev;
      return { ...prev, [activeWorkspaceId]: [] };
    });
    setActiveReferenceIdByWorkspace((prev) => ({
      ...prev,
      [activeWorkspaceId]: undefined,
    }));
  }, [activeWorkspaceId]);

  const setActiveReference = useCallback((nodeId: string | undefined) => {
    setActiveReferenceIdByWorkspace((prev) => ({
      ...prev,
      [activeWorkspaceId]: nodeId,
    }));
  }, [activeWorkspaceId]);

  const handleFocusReferenceNode = useCallback((workspaceId: string, nodeId: string) => {
    if (workspaceId !== activeWorkspaceId) onSelectWorkspace(workspaceId);
    requestNodeFocus(workspaceId, nodeId);
  }, [activeWorkspaceId, onSelectWorkspace, requestNodeFocus]);

  useEffect(() => {
    const current = referencesByWorkspace[activeWorkspaceId];
    if (!current?.length) return;
    const knownByWorkspace = new Map<string, Set<string>>();
    for (const [workspaceId, snapshot] of Object.entries(allNodes)) {
      knownByWorkspace.set(workspaceId, new Set(snapshot.map((node) => node.id)));
    }
    const filtered = current.filter((entry) => (
      entry.kind === 'url'
      || knownByWorkspace.get(entry.workspaceId)?.has(entry.nodeId)
      || !Object.prototype.hasOwnProperty.call(allNodes, entry.workspaceId)
    ));
    if (filtered.length === current.length) return;
    setReferencesByWorkspace((prev) => ({ ...prev, [activeWorkspaceId]: filtered }));
    setActiveReferenceIdByWorkspace((prev) => {
      const currentActive = prev[activeWorkspaceId];
      if (currentActive && filtered.some((entry) => (entry.kind === 'url' ? entry.id : `${entry.workspaceId}:${entry.nodeId}`) === currentActive)) return prev;
      const nextActive = filtered[0] ? (filtered[0].kind === 'url' ? filtered[0].id : `${filtered[0].workspaceId}:${filtered[0].nodeId}`) : undefined;
      return { ...prev, [activeWorkspaceId]: nextActive };
    });
  }, [activeWorkspaceId, allNodes, referencesByWorkspace]);

  const pinReferenceNode = useCallback((workspaceId: string, nodeId: string) => {
    setReferencesByWorkspace((prev) => {
      const current = prev[activeWorkspaceId] ?? [];
      const exists = current.some((entry) => entry.kind === 'node' && entry.workspaceId === workspaceId && entry.nodeId === nodeId);
      if (exists) return prev;
      const workspace = workspaces.find((item) => item.id === workspaceId);
      const node = (allNodes[workspaceId] ?? []).find((item) => item.id === nodeId);
      const entry: ReferenceEntry = {
        kind: 'node',
        workspaceId,
        nodeId,
        titleSnapshot: node ? getNodeDisplayLabel(node) : undefined,
        typeSnapshot: node?.type,
        workspaceNameSnapshot: workspace?.name,
      };
      return { ...prev, [activeWorkspaceId]: [...current, entry] };
    });
    setActiveReferenceIdByWorkspace((prev) => ({
      ...prev,
      [activeWorkspaceId]: `${workspaceId}:${nodeId}`,
    }));
    setReferenceDrawerOpen(true);
  }, [activeWorkspaceId, allNodes, workspaces]);

  const pinReferenceUrl = useCallback((url: string, title?: string) => {
    const id = `url:${url}`;
    setReferencesByWorkspace((prev) => {
      const current = prev[activeWorkspaceId] ?? [];
      const exists = current.some((entry) => 'kind' in entry && entry.kind === 'url' && entry.url === url);
      if (exists) return prev;
      const entry: ReferenceEntry = { kind: 'url', id, url, title };
      return { ...prev, [activeWorkspaceId]: [...current, entry] };
    });
    setActiveReferenceIdByWorkspace((prev) => ({
      ...prev,
      [activeWorkspaceId]: id,
    }));
    setReferenceDrawerOpen(true);
  }, [activeWorkspaceId]);

  const workspaceNameById = useCallback(
    (workspaceId: string) => workspaces.find((workspace) => workspace.id === workspaceId)?.name,
    [workspaces],
  );

  const resolveReferenceNode = useCallback((node: CanvasNode) => {
    const ref = node.ref;
    if (!ref || ref.kind !== 'workspace-node') return {};
    return {
      node: (allNodes[ref.workspaceId] ?? []).find((item) => item.id === ref.nodeId),
      workspaceName: workspaceNameById(ref.workspaceId),
    };
  }, [allNodes, workspaceNameById]);

  const resolveReferenceSource = useCallback((node: CanvasNode, fallbackWorkspaceId: string) => {
    if (node.type === 'reference' && node.ref?.kind === 'workspace-node') {
      const sourceNode = (allNodes[node.ref.workspaceId] ?? []).find((item) => item.id === node.ref?.nodeId);
      return sourceNode
        ? { workspaceId: node.ref.workspaceId, node: sourceNode }
        : undefined;
    }
    return { workspaceId: fallbackWorkspaceId, node };
  }, [allNodes]);

  const handleOpenReferenceSource = useCallback((node: CanvasNode) => {
    const ref = node.ref;
    if (!ref || ref.kind !== 'workspace-node') return;
    if (ref.workspaceId !== activeWorkspaceId) onSelectWorkspace(ref.workspaceId);
    requestNodeFocus(ref.workspaceId, ref.nodeId);
  }, [activeWorkspaceId, onSelectWorkspace, requestNodeFocus]);

  const addReferenceToCanvas = useCallback((entry: NodeReferenceEntryForCanvas) => {
    ensureWorkspaceNodesLoaded(entry.workspaceId);
    setReferencePlacementRequest(entry);
    setReferenceDrawerOpen(false);
  }, [ensureWorkspaceNodesLoaded]);

  const consumeReferencePlacementRequest = useCallback(() => {
    setReferencePlacementRequest(null);
  }, []);

  const createReferenceNodeFromEntry = useCallback((entry: NodeReferenceEntryForCanvas, x: number, y: number): CanvasNode | null => {
    const sourceNode = (allNodes[entry.workspaceId] ?? []).find((node) => node.id === entry.nodeId);
    const workspaceName = workspaceNameById(entry.workspaceId) ?? entry.workspaceNameSnapshot;
    const snapshot = sourceNode
      ? createReferenceNodeDataSnapshot(sourceNode, workspaceName)
      : {
          titleSnapshot: entry.titleSnapshot,
          typeSnapshot: entry.typeSnapshot === 'reference' ? undefined : entry.typeSnapshot,
          workspaceNameSnapshot: workspaceName,
        };
    const node = {
      ...createDefaultNode('reference', x, y),
      ...(sourceNode ? { width: sourceNode.width, height: sourceNode.height } : {}),
      title: snapshot.titleSnapshot ? `Ref: ${snapshot.titleSnapshot}` : 'Reference',
      ref: {
        kind: 'workspace-node' as const,
        workspaceId: entry.workspaceId,
        nodeId: entry.nodeId,
      },
      data: snapshot,
      updatedAt: Date.now(),
    };
    return node;
  }, [allNodes, workspaceNameById]);

  const createReferenceNodeFromSource = useCallback((sourceNode: CanvasNode, sourceWorkspaceId: string, x: number, y: number): CanvasNode | null => {
    if (!isReferenceableNode(sourceNode)) return null;
    const workspaceName = workspaceNameById(sourceWorkspaceId);
    const snapshot = createReferenceNodeDataSnapshot(sourceNode, workspaceName);
    return {
      ...createDefaultNode('reference', x, y),
      width: sourceNode.width,
      height: sourceNode.height,
      title: snapshot.titleSnapshot ? `Ref: ${snapshot.titleSnapshot}` : 'Reference',
      ref: {
        kind: 'workspace-node' as const,
        workspaceId: sourceWorkspaceId,
        nodeId: sourceNode.id,
      },
      data: snapshot,
      updatedAt: Date.now(),
    };
  }, [workspaceNameById]);

  const pasteReferencesIntoCanvas = useCallback((targetWorkspaceId: string, clipboard: CanvasClipboard): CanvasNode[] => {
    if (clipboard.sourceWorkspaceId === targetWorkspaceId || clipboard.nodes.length === 0) return [];

    const created: CanvasNode[] = [];
    let skipped = 0;
    for (const source of clipboard.nodes) {
      const pasteX = source.x + 24;
      const pasteY = source.y + 24;
      const resolved = resolveReferenceSource(source, clipboard.sourceWorkspaceId);

      if (source.type === 'reference' && source.ref?.kind === 'workspace-node' && !resolved) {
        const sourceSnapshot = source.data as ReferenceNodeData;
        if (sourceSnapshot.typeSnapshot && !isReferenceableNodeType(sourceSnapshot.typeSnapshot)) {
          skipped += 1;
          continue;
        }
        const snapshot: ReferenceNodeData = {
          titleSnapshot: sourceSnapshot.titleSnapshot,
          typeSnapshot: sourceSnapshot.typeSnapshot,
          workspaceNameSnapshot: sourceSnapshot.workspaceNameSnapshot ?? workspaceNameById(source.ref.workspaceId),
        };
        created.push({
          ...createDefaultNode('reference', pasteX, pasteY),
          width: source.width,
          height: source.height,
          title: snapshot.titleSnapshot ? `Ref: ${snapshot.titleSnapshot}` : source.title,
          ref: {
            kind: 'workspace-node',
            workspaceId: source.ref.workspaceId,
            nodeId: source.ref.nodeId,
          },
          data: snapshot,
          updatedAt: Date.now(),
        });
        continue;
      }

      const sourceWorkspaceId = resolved?.workspaceId ?? clipboard.sourceWorkspaceId;
      const sourceNode = resolved?.node ?? source;
      const refNode = createReferenceNodeFromSource(
        sourceNode,
        sourceWorkspaceId,
        pasteX,
        pasteY,
      );
      if (!refNode) {
        skipped += 1;
        continue;
      }
      created.push(refNode);
    }

    if (skipped > 0) {
      // Keep this quiet for now; unsupported nodes are simply ignored so
      // mixed selections can still paste the useful references.
      console.debug(`[canvas] skipped ${skipped} unsupported cross-workspace reference paste node(s)`);
    }

    return created;
  }, [createReferenceNodeFromSource, resolveReferenceSource, workspaceNameById]);

  const savePatchedWorkspaceSnapshot = useCallback((workspaceId: string, nodes: CanvasNode[]) => {
    const api = window.canvasWorkspace?.store;
    if (!api) return;
    void api.load(workspaceId).then((result) => {
      const current = result.ok && result.data
        ? result.data
        : { nodes: [], edges: [], transform: { x: 0, y: 0, scale: 1 }, savedAt: new Date().toISOString() };
      void api.save(workspaceId, {
        ...current,
        nodes,
        savedAt: new Date().toISOString(),
      });
    });
  }, []);

  const patchWorkspaceNodeSnapshot = useCallback((workspaceId: string, nodeId: string, patch: Partial<CanvasNode>) => {
    const patched = patchNodeSnapshot(workspaceId, nodeId, patch);
    if (patched) savePatchedWorkspaceSnapshot(workspaceId, patched);
  }, [patchNodeSnapshot, savePatchedWorkspaceSnapshot]);

  const updateReferenceSourceNode = useCallback((referenceNode: CanvasNode, patch: Partial<CanvasNode>) => {
    const ref = referenceNode.ref;
    if (!ref || ref.kind !== 'workspace-node') return;
    const source = (allNodes[ref.workspaceId] ?? []).find((item) => item.id === ref.nodeId);
    const sourceType = source?.type ?? (referenceNode.data as { typeSnapshot?: CanvasNode['type'] }).typeSnapshot;
    if (sourceType && !isReferenceableNodeType(sourceType)) return;

    if (mountedWorkspaceIds.has(ref.workspaceId)) {
      const requestId = ++patchRequestIdRef.current;
      setNodePatchRequest({ workspaceId: ref.workspaceId, nodeId: ref.nodeId, patch, requestId });
      return;
    }

    patchWorkspaceNodeSnapshot(ref.workspaceId, ref.nodeId, patch);
  }, [allNodes, mountedWorkspaceIds, patchWorkspaceNodeSnapshot]);

  const consumeNodePatchRequest = useCallback((requestId: number) => {
    setNodePatchRequest((prev) => (prev?.requestId === requestId ? undefined : prev));
  }, []);

  return {
    referenceDrawerOpen,
    setReferenceDrawerOpen,
    references,
    activeReference,
    activeReferenceNode,
    removeReference,
    clearAllReferences,
    setActiveReference,
    handleFocusReferenceNode,
    pinReferenceNode,
    pinReferenceUrl,
    resolveReferenceNode,
    handleOpenReferenceSource,
    referencePlacementRequest,
    addReferenceToCanvas,
    consumeReferencePlacementRequest,
    createReferenceNodeFromEntry,
    pasteReferencesIntoCanvas,
    updateReferenceSourceNode,
    nodePatchRequest,
    consumeNodePatchRequest,
  };
};
