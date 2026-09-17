import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { CanvasNode, ReferenceNodeData } from '../../../types';
import type { CanvasClipboard, CanvasNodePatchRequest } from '../../../types/ui-interaction';
import type { WorkspaceEntry } from '../../../shared/workspaces';
import type { NodeReferenceEntry as NodeReferenceEntryForCanvas } from '../../../shared/reference/types';
import { createReferenceNodeDataSnapshot } from '../../../shared/reference/utils';
import { createDefaultNode } from '../../../utils/nodeFactory';
import { isReferenceableNode, isReferenceableNodeType } from '../../../utils/referenceNodes';
import type { WorkbenchController } from './useWorkbenchState';

interface Options {
  allNodes: WorkbenchController['allNodes'];
  workspaces: WorkspaceEntry[];
  mountedWorkspaceIds: ReadonlySet<string>;
  patchNodeSnapshot: WorkbenchController['patchNodeSnapshot'];
  ensureWorkspaceNodesLoaded: WorkbenchController['ensureWorkspaceNodesLoaded'];
  setReferenceDrawerOpen: Dispatch<SetStateAction<boolean>>;
  peekNode: (workspaceId: string, nodeId: string) => void;
}

/** Owns cross-workspace reference creation, placement, clipboard and source updates. */
export const useReferenceOperations = ({
  allNodes,
  workspaces,
  mountedWorkspaceIds,
  patchNodeSnapshot,
  ensureWorkspaceNodesLoaded,
  setReferenceDrawerOpen,
  peekNode,
}: Options) => {
  const [canvasClipboard, setCanvasClipboard] = useState<CanvasClipboard | null>(null);
  const [nodePatchRequest, setNodePatchRequest] = useState<CanvasNodePatchRequest | undefined>();
  const patchRequestIdRef = useRef(0);
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
    peekNode(ref.workspaceId, ref.nodeId);
  }, [peekNode]);

  const [referencePlacementRequest, setReferencePlacementRequest] = useState<NodeReferenceEntryForCanvas | null>(null);

  const addReferenceToCanvas = useCallback((entry: NodeReferenceEntryForCanvas) => {
    ensureWorkspaceNodesLoaded(entry.workspaceId);
    setReferencePlacementRequest(entry);
    setReferenceDrawerOpen(false);
  }, [ensureWorkspaceNodesLoaded, setReferenceDrawerOpen]);

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
    const sourceType = source?.type ?? (referenceNode.data as { typeSnapshot?: CanvasNode['type']; }).typeSnapshot;
    if (sourceType && !isReferenceableNodeType(sourceType)) return;

    if (mountedWorkspaceIds.has(ref.workspaceId)) {
      const requestId = ++patchRequestIdRef.current;
      setNodePatchRequest({ workspaceId: ref.workspaceId, nodeId: ref.nodeId, patch, requestId });
      return;
    }

    patchWorkspaceNodeSnapshot(ref.workspaceId, ref.nodeId, patch);
  }, [allNodes, mountedWorkspaceIds, patchWorkspaceNodeSnapshot]);

  const completeNodePatch = useCallback((requestId: number) => {
    setNodePatchRequest((current) => current?.requestId === requestId ? undefined : current);
  }, []);

  return {
    canvasClipboard,
    setCanvasClipboard,
    nodePatchRequest,
    resolveReferenceNode,
    handleOpenReferenceSource,
    referencePlacementRequest,
    addReferenceToCanvas,
    consumeReferencePlacementRequest,
    createReferenceNodeFromEntry,
    pasteReferencesIntoCanvas,
    updateReferenceSourceNode,
    completeNodePatch,
  };
};
