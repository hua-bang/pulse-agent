import { useMemo } from 'react';
import type {
  AgentContextCanvasRef,
  AgentContextNodeRef,
  AgentContextTagRef,
  AgentRequestContext,
  CanvasNode,
} from '../../../../types';
import { getNodeDisplayLabel } from '../../../../utils/nodeLabel';
import type { SelectedContextChip } from '../../types';

interface Options {
  nodes?: CanvasNode[];
  selectedNodeIds?: string[];
  contextNodes?: AgentContextNodeRef[];
  contextTags?: AgentContextTagRef[];
  contextCanvases?: AgentContextCanvasRef[];
  executionMode: 'auto' | 'ask';
}

export const useChatPanelContext = ({
  nodes,
  selectedNodeIds,
  contextNodes,
  contextTags,
  contextCanvases,
  executionMode,
}: Options) => {
  const derivedSelectedNodes = useMemo(() => {
    const ids = new Set(selectedNodeIds ?? []);
    return (nodes ?? []).filter(node => ids.has(node.id));
  }, [nodes, selectedNodeIds]);
  const contextRefs = useMemo<AgentContextNodeRef[]>(() => {
    if (contextNodes) return contextNodes;
    return derivedSelectedNodes.map(node => ({
      id: node.id,
      title: getNodeDisplayLabel(node),
      type: node.type,
    }));
  }, [contextNodes, derivedSelectedNodes]);
  const selectedContext = useMemo<SelectedContextChip[]>(() => [
    ...contextRefs.map(ref => ({
      key: `node:${ref.workspaceId ?? ''}:${ref.id}`,
      kind: 'node' as const,
      nodeType: ref.type,
      label: ref.title,
    })),
    ...(contextCanvases ?? []).map(canvas => ({
      key: `canvas:${canvas.id}`,
      kind: 'canvas' as const,
      label: canvas.name,
    })),
    ...(contextTags ?? []).map(tag => ({
      key: `tag:${tag.name}`,
      kind: 'tag' as const,
      label: tag.name,
    })),
  ], [contextCanvases, contextRefs, contextTags]);
  const requestContext = useMemo<AgentRequestContext>(() => ({
    executionMode,
    scope: selectedContext.length > 0 ? 'selected_nodes' : 'current_canvas',
    selectedNodes: contextRefs,
    tags: contextTags,
    canvases: contextCanvases,
  }), [contextCanvases, contextRefs, contextTags, executionMode, selectedContext.length]);

  return { contextRefs, requestContext, selectedContext };
};
