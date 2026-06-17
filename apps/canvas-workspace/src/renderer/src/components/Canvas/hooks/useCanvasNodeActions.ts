import { useCallback, type MutableRefObject } from 'react';
import type { AgentNodeData, CanvasEdge, CanvasNode, FrameNodeData } from '../../../types';
import { useI18n } from '../../../i18n';
import { getNodeDisplayLabel } from '../../../utils/nodeLabel';
import { exportMindmapNodeToPng } from '../../../utils/mindmapExport';

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
  canvasId: string;
  removeNodes: (ids: string[]) => void;
  syncDeletedNodes: (ids: string[]) => void;
  removeEdge: (id: string) => void;
  groupNodes: (ids: string[]) => CanvasNode | null;
  ungroupNodes: (ids: string[]) => string[];
  wrapNodesInFrame: (ids: string[]) => CanvasNode | null;
  notify: (args: NotifyArgs) => void;
  confirm: (args: ConfirmArgs) => Promise<boolean>;
}

const getAgentTeamId = (node: CanvasNode): string | undefined => {
  if (node.type === 'frame') {
    const data = node.data as Partial<FrameNodeData>;
    return typeof data.agentTeamId === 'string' && data.agentTeamId ? data.agentTeamId : undefined;
  }
  if (node.type === 'agent') {
    const data = node.data as Partial<AgentNodeData>;
    return typeof data.agentTeamId === 'string' && data.agentTeamId ? data.agentTeamId : undefined;
  }
  return undefined;
};

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
  canvasId,
  removeNodes,
  syncDeletedNodes,
  removeEdge,
  groupNodes,
  ungroupNodes,
  wrapNodesInFrame,
  notify,
  confirm,
}: Options) => {
  void _selectedEdgeId;
  const { t } = useI18n();

  const requestRemoveNodes = useCallback(
    async (ids: string[]) => {
      const idSet = new Set(ids);
      const victims = nodesRef.current.filter((node) => idSet.has(node.id));
      if (victims.length === 0) return;

      // Single-node deletes stay instant (they're one undo step away);
      // multi-node deletes confirm first since one keystroke can wipe a
      // whole marquee selection.
      if (victims.length > 1) {
        const accepted = await confirm({
          intent: 'danger',
          title: t('canvas.deleteNodesTitle', { count: victims.length }),
          description: t('canvas.deleteNodesDescription'),
          confirmLabel: t('canvas.deleteNodesConfirm'),
        });
        if (!accepted) return;
      }

      const teamIds = Array.from(new Set(
        victims
          .map(getAgentTeamId)
          .filter((teamId): teamId is string => !!teamId),
      ));
      const teamVictimIds = new Set(
        victims
          .filter((node) => !!getAgentTeamId(node))
          .map((node) => node.id),
      );
      const normalVictimIds = victims
        .filter((node) => !teamVictimIds.has(node.id))
        .map((node) => node.id);
      const removedIds = new Set<string>();

      if (teamIds.length > 0) {
        const api = window.canvasWorkspace?.agentTeams;
        if (!api) {
          notify({
            tone: 'error',
            title: t('canvas.agentTeamDeleteFailed'),
            description: t('canvas.agentTeamApiUnavailable'),
          });
          return;
        }

        const deletedTeamNodeIds = new Set<string>();
        for (const teamId of teamIds) {
          const result = await api.delete(canvasId, teamId);
          if (!result.ok) {
            notify({
              tone: 'error',
              title: t('canvas.agentTeamDeleteFailed'),
              description: result.error ?? t('canvas.agentTeamDeleteFailedDescription'),
            });
            return;
          }
          for (const nodeId of result.deletedNodeIds ?? []) deletedTeamNodeIds.add(nodeId);
        }

        const deletedIds = Array.from(deletedTeamNodeIds);
        syncDeletedNodes(deletedIds);
        for (const nodeId of deletedIds) removedIds.add(nodeId);
      }

      if (normalVictimIds.length > 0) {
        removeNodes(normalVictimIds);
        for (const nodeId of normalVictimIds) removedIds.add(nodeId);
      }

      setSelectedNodeIds((current) => current.filter((id) => !removedIds.has(id)));
    },
    [canvasId, confirm, nodesRef, notify, removeNodes, setSelectedNodeIds, syncDeletedNodes, t],
  );

  const requestRemoveEdge = useCallback(
    async (id: string) => {
      const edge = edges.find((item) => item.id === id);
      if (!edge) return;

      const accepted = await confirm({
        intent: 'danger',
        title: t('canvas.deleteConnectionTitle'),
        description: t('canvas.deleteConnectionDescription'),
        confirmLabel: t('canvas.deleteConnectionConfirm'),
      });
      if (!accepted) return;

      removeEdge(id);
      setSelectedEdgeId((current) => (current === id ? null : current));
      if (editingEdgeLabelId === id) setEditingEdgeLabelId(null);
      notify({
        tone: 'success',
        title: t('canvas.connectionDeleted'),
        description: edge.label?.trim() ? edge.label : t('canvas.connectionDeletedDescription'),
      });
    },
    [edges, confirm, removeEdge, editingEdgeLabelId, setEditingEdgeLabelId, notify, setSelectedEdgeId, t],
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
      title: t('canvas.nodesGrouped'),
      description: t('canvas.nodesGroupedDescription', { count: selectedNodeIds.length }),
    });
  }, [groupNodes, selectedNodeIds, notify, setSelectedNodeIds, t]);

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
      title: selectedGroups.length === 1 ? t('canvas.groupDissolved') : t('canvas.groupsDissolved'),
      description: releasedIds.length > 0
        ? t('canvas.groupDissolvedDescription', { count: releasedIds.length })
        : t('canvas.groupDissolvedEmpty'),
    });
  }, [selectedNodeIds, ungroupNodes, notify, nodesRef, setSelectedNodeIds, t]);

  const wrapSelectedNodesInFrame = useCallback(() => {
    if (selectedNodeIds.length === 0) return;
    const frame = wrapNodesInFrame(selectedNodeIds);
    if (!frame) return;
    setSelectedNodeIds([frame.id]);
    notify({
      tone: 'success',
      title: t('canvas.frameCreated'),
      description: t('canvas.frameCreatedDescription', { count: selectedNodeIds.length }),
    });
  }, [wrapNodesInFrame, selectedNodeIds, notify, setSelectedNodeIds, t]);

  const handleExportMindmapImage = useCallback(
    async (nodeId: string) => {
      const node = nodesRef.current.find((item) => item.id === nodeId);
      const api = window.canvasWorkspace?.file;
      if (!node || node.type !== 'mindmap' || !api) return;

      notify({
        tone: 'loading',
        title: t('canvas.mindmapExporting'),
        description: getNodeDisplayLabel(node),
      });

      try {
        const image = await exportMindmapNodeToPng(node);
        const result = await api.exportImage(image.fileName, image.data, 'png');
        if (!result.ok) {
          if (result.canceled) {
            notify({
              tone: 'info',
              title: t('canvas.mindmapExportCanceled'),
              description: getNodeDisplayLabel(node),
            });
            return;
          }
          throw new Error(result.error ?? t('canvas.mindmapExportSaveFailed'));
        }
        notify({
          tone: 'success',
          title: t('canvas.mindmapExported'),
          description: result.filePath ?? image.fileName,
        });
      } catch (err) {
        notify({
          tone: 'error',
          title: t('canvas.mindmapExportFailed'),
          description: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [notify, nodesRef, t],
  );

  // External-delete request handler (e.g. sidebar layers context menu).
  // The parent passes the id in; this clears selection consistently.
  const handleExternalDelete = useCallback(
    (deleteNodeId: string) => {
      if (nodesRef.current.some((n) => n.id === deleteNodeId)) {
        void requestRemoveNodes([deleteNodeId]);
      }
    },
    [nodesRef, requestRemoveNodes],
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
