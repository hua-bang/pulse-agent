import type { CrossWorkspaceSessionGroup } from '../../../../../shared/agent-chat';
import type { AgentScope, OtherWorkspaceSession } from '../types';
import { chatScopeKey } from '../utils/sessionScope';

export function partitionSessionGroups(
  groups: CrossWorkspaceSessionGroup[],
  currentScope: AgentScope,
) {
  const otherSessions: OtherWorkspaceSession[] = [];
  const currentScopeKey = chatScopeKey(currentScope);
  const currentGroup = groups.find(group => chatScopeKey(group.scope) === currentScopeKey);
  for (const group of groups) {
    if (group === currentGroup) continue;
    for (const session of group.sessions) {
      otherSessions.push({
        ...session,
        sourceScope: group.scope,
        workspaceName: group.scopeName,
      });
    }
  }
  otherSessions.sort((left, right) => {
    const leftUpdatedAt = left.updatedAt ?? (Date.parse(left.date) || 0);
    const rightUpdatedAt = right.updatedAt ?? (Date.parse(right.date) || 0);
    return rightUpdatedAt - leftUpdatedAt;
  });
  return {
    sessions: currentGroup?.sessions ?? [],
    currentScopeName: currentGroup?.scopeName ?? null,
    otherSessions,
  };
}
