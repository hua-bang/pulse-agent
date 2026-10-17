import { useMemo } from 'react';
import type {
  AgentContextCanvasRef,
  AgentContextNodeRef,
  AgentContextTagRef,
  AgentRequestContext,
  CanvasNode,
} from '../../../../../types';
import { getNodeDisplayLabel } from '../../../../../utils/nodeLabel';
import type { SelectedContextChip } from '../../ChatComposer/types';
import { useGlobalMcpApps } from '../../../../mcp-apps/global-apps';

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
  // The open MCP app's context is sent with every turn (collectEditableContext),
  // so it is shown too.
  const { running, activeKey } = useGlobalMcpApps();
  const activeAppTitle = running.find(app => app.key === activeKey)?.listing.title;
  const selectedContext = useMemo<SelectedContextChip[]>(() => [
    ...(activeAppTitle ? [{
      key: `app:${activeKey}`,
      kind: 'app' as const,
      label: activeAppTitle,
      removable: false,
    }] : []),
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
  ], [activeAppTitle, activeKey, contextCanvases, contextRefs, contextTags]);
  const requestContext = useMemo<AgentRequestContext>(() => ({
    executionMode,
    // The app chip is page context, not a selection.
    scope: selectedContext.some(chip => chip.kind !== 'app') ? 'selected_nodes' : 'current_canvas',
    selectedNodes: contextRefs,
    tags: contextTags,
    canvases: contextCanvases,
  }), [contextCanvases, contextRefs, contextTags, executionMode, selectedContext]);

  return { contextRefs, requestContext, selectedContext };
};
