import { useCallback, type MutableRefObject } from 'react';
import type { CanvasEdge, CanvasNode } from '../types';
import { getNodeDisplayLabel } from '../utils/nodeLabel';
import { exportMindmapNodeToPng } from '../utils/mindmapExport';

interface NotifyArgs {
  tone: 'success' | 'info' | 'error' | 'loading';
  title: string;
  description?: string;
}

interface ConfirmArgs {
  intent?: 'danger' | 'default';
  title: string;
  description?: string;
  confirmLabel?: string;
}

interface Options {
  nodesRef: MutableRefObject<CanvasNode[]>;
  edges: CanvasEdge[];
  selectedNodeIds: string[];
  setSelectedNodeIds: React.Dispatch<React.SetStateAction<string[]>>;
  selectedEdgeId: string | null;
  setSelectedEdgeId: React.Dispatch<React.SetStateAction<string | null>>;
  editingEdgeLabelId: string | null;
  setEditingEdgeLabelId: (id: string | null) => void;
  removeNode: (id: string) => void;
  removeNodes: (ids: string[]) => void;
  removeEdge: (id: string) => void;
  groupNodes: (ids: string[]) => CanvasNode | null;
  ungroupNodes: (ids: string[]) => string[];
  wrapNodesInFrame: (ids: string[]) => CanvasNode | null;
  notify: (args: NotifyArgs) => void;
  confirm: (args: ConfirmArgs) => Promise<boolean>;
}

/**
 * Bundles the canvas's higher-level mutation callbacks — group / ungroup
 * / wrap-in-frame, the confirmed edge delete, the safe multi-node
 * delete, and the mindmap → PNG exporter. Pure callbacks; no internal
 * state. Keeps the parent's body free of toast / confirm boilerplate.
 */
export const useCanvasNodeActions = ({
  nodesRef,
  edges,
  selectedNodeIds,
  setSelectedNodeIds,
  selectedEdgeId: _selectedEdgeId,
  setSelectedEdgeId,
  editingEdgeLabelId,
  setEditingEdgeLabelId,
  removeNode,
  removeNodes,
  removeEdge,
  groupNodes,
  ungroupNodes,
  wrapNodesInFrame,
  notify,
  confirm,
}: Options) => {
  void _selectedEdgeId;

  const requestRemoveNodes = useCallback(
    (ids: string[]) => {
      const idSet = new Set(ids);
      const victims = nodesRef.current.filter((node) => idSet.has(node.id));
      if (victims.length === 0) return;

      removeNodes(victims.map((node) => node.id));
      const removedIds = new Set(victims.map((node) => node.id));
      setSelectedNodeIds((current) => current.filter((id) => !removedIds.has(id)));
    },
    [removeNodes, nodesRef, setSelectedNodeIds],
  );

  const requestRemoveEdge = useCallback(
    async (id: string) => {
      const edge = edges.find((item) => item.id === id);
      if (!edge) return;

      const accepted = await confirm({
        intent: 'danger',
        title: 'Delete this connection?',
        description: 'This removes the arrow and its label from the canvas.',
        confirmLabel: 'Delete connection',
      });
      if (!accepted) return;

      removeEdge(id);
      setSelectedEdgeId((current) => (current === id ? null : current));
      if (editingEdgeLabelId === id) setEditingEdgeLabelId(null);
      notify({
        tone: 'success',
        title: 'Connection deleted',
        description: edge.label?.trim() ? edge.label : 'Arrow removed from the canvas.',
      });
    },
    [edges, confirm, removeEdge, editingEdgeLabelId, setEditingEdgeLabelId, notify, setSelectedEdgeId],
  );

  const handleRemoveNode = useCallback(
    (id: string) => {
      void requestRemoveNodes([id]);
    },
    [requestRemoveNodes],
  );

  const groupSelectedNodes = useCallback(() => {
    if (selectedNodeIds.length === 0) return;
    const group = groupNodes(selectedNodeIds);
    if (!group) return;
    setSelectedNodeIds([group.id]);
    notify({
      tone: 'success',
      title: 'Nodes grouped',
      description: `Grouped ${selectedNodeIds.length} node${selectedNodeIds.length === 1 ? '' : 's'}.`,
    });
  }, [groupNodes, selectedNodeIds, notify, setSelectedNodeIds]);

  const ungroupSelectedNodes = useCallback(() => {
    if (selectedNodeIds.length === 0) return;
    const selectedGroups = nodesRef.current.filter(
      (node) => selectedNodeIds.includes(node.id) && node.type === 'group',
    );
    if (selectedGroups.length === 0) return;
    const releasedIds = ungroupNodes(selectedGroups.map((node) => node.id));
    setSelectedNodeIds(releasedIds);
    notify({
      tone: 'success',
      title: selectedGroups.length === 1 ? 'Group dissolved' : 'Groups dissolved',
      description: releasedIds.length > 0
        ? `Released ${releasedIds.length} child node${releasedIds.length === 1 ? '' : 's'}.`
        : 'Removed empty group container.',
    });
  }, [selectedNodeIds, ungroupNodes, notify, nodesRef, setSelectedNodeIds]);

  const wrapSelectedNodesInFrame = useCallback(() => {
    if (selectedNodeIds.length === 0) return;
    const frame = wrapNodesInFrame(selectedNodeIds);
    if (!frame) return;
    setSelectedNodeIds([frame.id]);
    notify({
      tone: 'success',
      title: 'Frame created',
      description: `Wrapped ${selectedNodeIds.length} node${selectedNodeIds.length === 1 ? '' : 's'} in a new frame.`,
    });
  }, [wrapNodesInFrame, selectedNodeIds, notify, setSelectedNodeIds]);

  const handleExportMindmapImage = useCallback(
    async (nodeId: string) => {
      const node = nodesRef.current.find((item) => item.id === nodeId);
      const api = window.canvasWorkspace?.file;
      if (!node || node.type !== 'mindmap' || !api) return;

      notify({
        tone: 'loading',
        title: 'Exporting mindmap...',
        description: getNodeDisplayLabel(node),
      });

      try {
        const image = await exportMindmapNodeToPng(node);
        const result = await api.exportImage(image.fileName, image.data, 'png');
        if (!result.ok) {
          if (result.canceled) {
            notify({
              tone: 'info',
              title: 'Export canceled',
              description: getNodeDisplayLabel(node),
            });
            return;
          }
          throw new Error(result.error ?? 'The image could not be saved.');
        }
        notify({
          tone: 'success',
          title: 'Mindmap image exported',
          description: result.filePath ?? image.fileName,
        });
      } catch (err) {
        notify({
          tone: 'error',
          title: 'Mindmap export failed',
          description: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [notify, nodesRef],
  );

  // External-delete request handler (e.g. sidebar layers context menu).
  // The parent passes the id in; this clears selection consistently.
  const handleExternalDelete = useCallback(
    (deleteNodeId: string) => {
      if (nodesRef.current.some((n) => n.id === deleteNodeId)) {
        removeNode(deleteNodeId);
        setSelectedNodeIds((ids) => ids.filter((id) => id !== deleteNodeId));
      }
    },
    [removeNode, nodesRef, setSelectedNodeIds],
  );

  return {
    requestRemoveNodes,
    requestRemoveEdge,
    handleRemoveNode,
    groupSelectedNodes,
    ungroupSelectedNodes,
    wrapSelectedNodesInFrame,
    handleExportMindmapImage,
    handleExternalDelete,
  };
};
