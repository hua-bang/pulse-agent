import { useCallback, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { CanvasNode, IframeNodeData } from '../../../../../../types';
import type { useAppShell } from '../../../../../../shared/appShell';
import { getNodeDefaultSize } from '../../../../../../utils/nodeFactory';
import { getUrlHostname, normalizeReferenceUrl } from '../../../../../../shared/reference/utils';
import type { useCanvasDocument } from '../../../../document/useCanvasDocument';
import {
  getSelectionAfterMindmapMerge,
  type MergeMindmapTopicRequest,
} from '../../../../mindmap/transfer';
import { useCanvasDemoCanvas } from './useCanvasDemoCanvas';

interface Options {
  surface: {
    canvasId: string;
    canvasName?: string;
    rootFolder?: string;
    containerRef: RefObject<HTMLDivElement>;
    screenToCanvas: (clientX: number, clientY: number, container: HTMLElement) => { x: number; y: number };
  };
  document: Pick<
    ReturnType<typeof useCanvasDocument>,
    'addNode' | 'updateNode' | 'addEdge' | 'mergeMindmapTopic' | 'splitMindmapTopic' | 'syncDeletedNodes'
  >;
  selection: {
    nodesRef: RefObject<CanvasNode[]>;
    setSelectedNodeIds: Dispatch<SetStateAction<string[]>>;
    setHighlightedId: Dispatch<SetStateAction<string | null>>;
  };
  feedback: {
    notify: ReturnType<typeof useAppShell>['notify'];
    updateToast: ReturnType<typeof useAppShell>['updateToast'];
    t: (key: any, params?: any) => string;
  };
}

export const useCanvasCreationActions = ({ surface, document, selection, feedback }: Options) => {
  const { canvasId, canvasName, rootFolder, containerRef, screenToCanvas } = surface;
  const { addNode, updateNode, addEdge, mergeMindmapTopic, splitMindmapTopic, syncDeletedNodes } = document;
  const { nodesRef, setSelectedNodeIds, setHighlightedId } = selection;
  const { notify, updateToast, t } = feedback;

  const getViewportCenter = useCallback(() => {
    const container = containerRef.current;
    if (!container) return null;
    const rect = container.getBoundingClientRect();
    return screenToCanvas(rect.left + rect.width / 2, rect.top + rect.height / 2, container);
  }, [containerRef, screenToCanvas]);

  const splitMindmap = useCallback((sourceNodeId: string, sourceTopicId: string, clientX: number, clientY: number) => {
    const container = containerRef.current;
    if (!container) return false;
    const point = screenToCanvas(clientX, clientY, container);
    return splitMindmapTopic({
      sourceNodeId,
      sourceTopicId,
      x: point.x - 24,
      y: point.y - 24,
    }) !== null;
  }, [containerRef, screenToCanvas, splitMindmapTopic]);

  const mergeMindmap = useCallback((request: MergeMindmapTopicRequest): boolean => {
    const nextSelection = getSelectionAfterMindmapMerge(nodesRef.current ?? [], request);
    const changed = mergeMindmapTopic(request);
    if (changed && nextSelection) setSelectedNodeIds(nextSelection);
    return changed;
  }, [mergeMindmapTopic, nodesRef, setSelectedNodeIds]);

  const removeNodesLocally = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    const removed = new Set(ids);
    syncDeletedNodes(ids);
    setSelectedNodeIds((current) => current.filter((id) => !removed.has(id)));
  }, [setSelectedNodeIds, syncDeletedNodes]);

  const createUrlNode = useCallback((value: string): CanvasNode | null => {
    const url = normalizeReferenceUrl(value);
    const center = getViewportCenter();
    if (!url || !center) return null;
    const size = getNodeDefaultSize('iframe');
    const node = addNode('iframe', center.x - size.width / 2, center.y - size.height / 2);
    const patch = {
      title: getUrlHostname(url) || url,
      data: { url, html: '', mode: 'url', prompt: '' } satisfies IframeNodeData,
    };
    updateNode(node.id, patch);
    setSelectedNodeIds([node.id]);
    setHighlightedId(node.id);
    return { ...node, ...patch };
  }, [addNode, getViewportCenter, setHighlightedId, setSelectedNodeIds, updateNode]);

  const createAgentTeam = useCallback(() => {
    const api = window.canvasWorkspace?.agentTeams;
    const center = getViewportCenter();
    if (!api || !center) return;
    const toastId = notify({
      tone: 'loading',
      title: t('canvas.agentTeamCreating'),
      description: canvasName ?? canvasId,
    });
    void api.create({
      workspaceId: canvasId,
      name: t('canvas.agentTeamName'),
      goal: t('canvas.agentTeamGoal'),
      cwd: rootFolder,
      leadName: t('canvas.agentTeamLeadName'),
      x: center.x - 560,
      y: center.y - 310,
    }).then((result) => {
      if (!result.ok || !result.snapshot) {
        updateToast(toastId, {
          tone: 'error',
          title: t('canvas.agentTeamCreationFailed'),
          description: result.error ?? t('canvas.agentTeamCreateFailedDescription'),
          autoCloseMs: 4200,
        });
        return;
      }
      const frameNodeId = result.snapshot.frameNodeId;
      if (frameNodeId) {
        setSelectedNodeIds([frameNodeId]);
        setHighlightedId(frameNodeId);
      }
      updateToast(toastId, {
        tone: 'success',
        title: t('canvas.agentTeamCreated'),
        description: t('canvas.agentTeamCreatedDescription'),
        autoCloseMs: 2800,
      });
    }).catch((error) => {
      updateToast(toastId, {
        tone: 'error',
        title: t('canvas.agentTeamCreationFailed'),
        description: error instanceof Error ? error.message : String(error),
        autoCloseMs: 4200,
      });
    });
  }, [canvasId, canvasName, getViewportCenter, notify, rootFolder, setHighlightedId, setSelectedNodeIds, t, updateToast]);

  const createDemoCanvas = useCanvasDemoCanvas({
    addEdge,
    addNode,
    getViewportCenter,
    notify,
    rootFolder,
    setHighlightedId,
    setSelectedNodeIds,
    t,
    updateNode,
  });

  return {
    createAgentTeam,
    createDemoCanvas,
    createUrlNode,
    getViewportCenter,
    mergeMindmap,
    removeNodesLocally,
    splitMindmap,
  };
};
