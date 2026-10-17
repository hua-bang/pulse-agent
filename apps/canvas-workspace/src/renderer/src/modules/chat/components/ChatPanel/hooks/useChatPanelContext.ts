import { useMemo } from 'react';
import type {
  AgentContextCanvasRef,
  AgentContextNodeRef,
  AgentContextScheduledTaskRef,
  AgentContextTagRef,
  AgentRequestContext,
  CanvasNode,
} from '../../../../../types';
import { getNodeDisplayLabel } from '../../../../../utils/nodeLabel';
import type { SelectedContextChip } from '../../ChatComposer/types';
import { useGlobalMcpApps } from '../../../../mcp-apps/global-apps';
import { useOpenSkillChatContext } from '../../../../../shared/skillChatContext';

interface Options {
  nodes?: CanvasNode[];
  selectedNodeIds?: string[];
  contextNodes?: AgentContextNodeRef[];
  contextTags?: AgentContextTagRef[];
  contextCanvases?: AgentContextCanvasRef[];
  contextScheduledTasks?: AgentContextScheduledTaskRef[];
  executionMode: 'auto' | 'ask';
}

export const useChatPanelContext = ({
  nodes,
  selectedNodeIds,
  contextNodes,
  contextTags,
  contextCanvases,
  contextScheduledTasks,
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
  const openSkill = useOpenSkillChatContext();
  const selectedContext = useMemo<SelectedContextChip[]>(() => [
    ...(activeAppTitle ? [{
      key: `app:${activeKey}`,
      kind: 'app' as const,
      label: activeAppTitle,
      removable: false,
    }] : []),
    ...(openSkill ? [{
      key: `skill:${openSkill.path}`,
      kind: 'skill' as const,
      label: openSkill.name,
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
    ...(contextScheduledTasks ?? []).map(task => ({
      key: `task:${task.id}`,
      kind: 'task' as const,
      label: task.title,
    })),
    ...(contextTags ?? []).map(tag => ({
      key: `tag:${tag.name}`,
      kind: 'tag' as const,
      label: tag.name,
    })),
  ], [activeAppTitle, activeKey, contextCanvases, contextRefs, contextScheduledTasks, contextTags, openSkill]);
  const requestContext = useMemo<AgentRequestContext>(() => ({
    executionMode,
    // App and skill chips are page context, not a selection.
    scope: selectedContext.some(chip => chip.removable !== false) ? 'selected_nodes' : 'current_canvas',
    selectedNodes: contextRefs,
    tags: contextTags,
    canvases: contextCanvases,
    scheduledTasks: contextScheduledTasks,
    skills: openSkill ? [openSkill] : undefined,
  }), [contextCanvases, contextRefs, contextScheduledTasks, contextTags, executionMode, openSkill, selectedContext]);

  return { contextRefs, requestContext, selectedContext };
};
