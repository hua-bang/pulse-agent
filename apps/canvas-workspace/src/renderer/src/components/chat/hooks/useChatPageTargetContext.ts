import { useCallback, useMemo, useState } from 'react';
import type { AgentRequestContext } from '../../../types';
import { useI18n } from '../../../i18n';
import type { AgentScope, SelectedContextChip, WorkspaceOption } from '../types';
import type {
  ChatContextSnapshot,
  ChatExecutionPolicy,
} from '../../../agent-chat/target';

interface Options {
  agentScope: AgentScope;
  allWorkspaces: WorkspaceOption[];
  contextSnapshot?: ChatContextSnapshot;
  executionPolicy: ChatExecutionPolicy;
  fixedTitle?: string;
}

const EMPTY_REMOVED_CONTEXT = new Set<string>();
const nodeContextKey = (workspaceId: string | undefined, id: string) => (
  `node:${workspaceId ?? ''}:${id}`
);
const canvasContextKey = (id: string) => `canvas:${id}`;
const tagContextKey = (name: string) => `tag:${name}`;

export const useChatPageTargetContext = ({
  agentScope,
  allWorkspaces,
  contextSnapshot,
  executionPolicy,
  fixedTitle,
}: Options) => {
  const { t } = useI18n();
  const contextSource = contextSnapshot?.requestContext;
  const [removedContext, setRemovedContext] = useState<{
    source?: AgentRequestContext;
    keys: Set<string>;
  }>({ source: contextSource, keys: new Set() });
  const removedKeys = removedContext.source === contextSource
    ? removedContext.keys
    : EMPTY_REMOVED_CONTEXT;
  const removeInheritedContext = useCallback((key: string) => {
    setRemovedContext(previous => {
      const keys = previous.source === contextSource
        ? new Set(previous.keys)
        : new Set<string>();
      keys.add(key);
      return { source: contextSource, keys };
    });
  }, [contextSource]);
  const workspaceName = agentScope.kind === 'workspace'
    ? allWorkspaces.find(workspace => workspace.id === agentScope.workspaceId)?.name
    : undefined;
  const scopeLabel = contextSnapshot?.label
    ?? (agentScope.kind === 'global'
      ? t('chat.scope.global')
      : agentScope.kind === 'scheduled'
        ? fixedTitle ?? t('chat.scope.scheduled')
        : workspaceName ?? agentScope.workspaceId);
  const requestContext = useMemo<AgentRequestContext>(() => {
    const selectedNodes = contextSource?.selectedNodes?.filter(node => (
      !removedKeys.has(nodeContextKey(node.workspaceId, node.id))
    ));
    const canvases = contextSource?.canvases?.filter(canvas => (
      !removedKeys.has(canvasContextKey(canvas.id))
    ));
    const tags = contextSource?.tags?.filter(tag => (
      !removedKeys.has(tagContextKey(tag.name))
    ));
    const hasSelectedContext = Boolean(
      selectedNodes?.length
      || canvases?.length
      || tags?.length
      || contextSource?.domSelections?.length
      || contextSource?.tabs?.length,
    );
    return {
      ...contextSource,
      selectedNodes,
      canvases,
      tags,
      scope: contextSource?.scope === 'selected_nodes' && !hasSelectedContext
        ? 'current_canvas'
        : contextSource?.scope,
      executionMode: executionPolicy === 'ask' ? 'ask' : 'auto',
    };
  }, [contextSource, executionPolicy, removedKeys]);
  const inheritedContextChips = useMemo<SelectedContextChip[]>(() => [
    ...(requestContext.selectedNodes ?? []).map(node => ({
      key: nodeContextKey(node.workspaceId, node.id),
      kind: 'node' as const,
      nodeType: node.type,
      label: node.title,
    })),
    ...(requestContext.canvases ?? []).map(canvas => ({
      key: canvasContextKey(canvas.id),
      kind: 'canvas' as const,
      label: canvas.name,
    })),
    ...(requestContext.tags ?? []).map(tag => ({
      key: tagContextKey(tag.name),
      kind: 'tag' as const,
      label: tag.name,
    })),
  ], [requestContext.canvases, requestContext.selectedNodes, requestContext.tags]);
  const resolvedContextSnapshot = useMemo<ChatContextSnapshot>(() => ({
    label: scopeLabel,
    requestContext,
  }), [requestContext, scopeLabel]);

  return {
    inheritedContextChips,
    removeInheritedContext,
    requestContext,
    resolvedContextSnapshot,
    scopeLabel,
  };
};
