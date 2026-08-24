import type {
  AgentRequestContext,
  AgentScope,
  AgentTurnContextSnapshot,
} from '../../../types';

export function createTurnContextSnapshot(
  scope: AgentScope,
  requestContext: AgentRequestContext | undefined,
  options: { modelLabel: string; scopeLabel: string; capturedAt?: number },
): AgentTurnContextSnapshot {
  return {
    scope,
    scopeLabel: options.scopeLabel,
    executionMode: requestContext?.executionMode ?? 'auto',
    modelLabel: options.modelLabel,
    capturedAt: options.capturedAt ?? Date.now(),
    selectedNodes: requestContext?.selectedNodes,
    tags: requestContext?.tags,
    canvases: requestContext?.canvases,
    domSelections: requestContext?.domSelections,
    tabs: requestContext?.tabs,
    plugins: requestContext?.plugins,
  };
}

export function requestContextFromSnapshot(
  snapshot: AgentTurnContextSnapshot,
): AgentRequestContext {
  const hasSelection = (
    (snapshot.selectedNodes?.length ?? 0)
    + (snapshot.tags?.length ?? 0)
    + (snapshot.canvases?.length ?? 0)
    + (snapshot.domSelections?.length ?? 0)
  ) > 0;
  return {
    executionMode: snapshot.executionMode,
    scope: hasSelection ? 'selected_nodes' : 'current_canvas',
    selectedNodes: snapshot.selectedNodes,
    tags: snapshot.tags,
    canvases: snapshot.canvases,
    domSelections: snapshot.domSelections,
    tabs: snapshot.tabs,
    plugins: snapshot.plugins,
    contextSnapshot: snapshot,
  };
}
