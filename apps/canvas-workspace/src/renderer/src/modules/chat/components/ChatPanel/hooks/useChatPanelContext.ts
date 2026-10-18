import { useMemo } from 'react';
import type {
  AgentContextCanvasRef,
  AgentContextNodeRef,
  AgentContextScheduledTaskRef,
  AgentContextTagRef,
  AgentRequestContext,
} from '../../../../../types';
import type { SelectedContextChip } from '../../ChatComposer/types';
import { useGlobalMcpApps } from '../../../../mcp-apps/global-apps';
import { useOpenSkillChatContext } from '../../../../../shared/skillChatContext';

/** Canvas selection is not chat context: a user may select a node only to
 * edit it. Nodes reach the turn through an inline @ mention or an explicit
 * `contextNodes` list (e.g. the Knowledge page's opened node). */
interface Options {
  contextNodes?: AgentContextNodeRef[];
  contextTags?: AgentContextTagRef[];
  contextCanvases?: AgentContextCanvasRef[];
  contextScheduledTasks?: AgentContextScheduledTaskRef[];
  executionMode: 'auto' | 'ask';
}

const EMPTY_CONTEXT_NODES: AgentContextNodeRef[] = [];

export const useChatPanelContext = ({
  contextNodes,
  contextTags,
  contextCanvases,
  contextScheduledTasks,
  executionMode,
}: Options) => {
  const contextRefs = contextNodes ?? EMPTY_CONTEXT_NODES;
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
