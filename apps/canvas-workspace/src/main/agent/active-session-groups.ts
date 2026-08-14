import { GLOBAL_CHAT_WORKSPACE_NAME } from './session-store';
import { scopeSessionStoreId } from '../../shared/agent-chat';
import type { CanvasAgent } from './canvas-agent';
import type { AgentScope, CrossWorkspaceSessionGroup } from './types';

interface AppendActiveSessionGroupsOptions {
  agents: Map<string, CanvasAgent>;
  groups: CrossWorkspaceSessionGroup[];
  includedStoreIds: Set<string>;
  scheduledTitles: Map<string, string>;
  workspaceNames: Record<string, string>;
}

export const scopeFromServiceKey = (key: string): AgentScope => {
  if (key === 'global') return { kind: 'global' };
  if (key.startsWith('scheduled:')) {
    return { kind: 'scheduled', taskId: key.slice('scheduled:'.length) };
  }
  return { kind: 'workspace', workspaceId: key.slice('workspace:'.length) };
};

const scopeDisplayName = (
  scope: AgentScope,
  scheduledTitles: Map<string, string>,
  workspaceNames: Record<string, string>,
): string => {
  if (scope.kind === 'global') return GLOBAL_CHAT_WORKSPACE_NAME;
  if (scope.kind === 'scheduled') {
    return scheduledTitles.get(scope.taskId) || scope.taskId;
  }
  return workspaceNames[scope.workspaceId] || scope.workspaceId;
};

/**
 * Add active scopes that have listable history but are absent from the disk
 * result. Empty current pointers are deliberately omitted by both the store
 * and the active agent, so a just-opened draft never creates a history folder.
 */
export async function appendActiveSessionGroups({
  agents,
  groups,
  includedStoreIds,
  scheduledTitles,
  workspaceNames,
}: AppendActiveSessionGroupsOptions): Promise<void> {
  for (const [key, agent] of agents) {
    const scope = scopeFromServiceKey(key);
    const storeId = scopeSessionStoreId(scope);
    if (includedStoreIds.has(storeId)) continue;
    const sessions = await agent.listSessions();
    if (sessions.length === 0) continue;
    includedStoreIds.add(storeId);
    groups.push({
      workspaceId: storeId,
      workspaceName: scopeDisplayName(scope, scheduledTitles, workspaceNames),
      sessions,
    });
  }
}
