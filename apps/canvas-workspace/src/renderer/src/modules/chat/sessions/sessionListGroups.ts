import type { CrossWorkspaceSessionGroup } from '../../../../../shared/agent-chat';
import type { OtherWorkspaceSession } from '../../../types';

export function partitionSessionGroups(
  groups: CrossWorkspaceSessionGroup[],
  currentStoreId: string,
) {
  const otherSessions: OtherWorkspaceSession[] = [];
  const currentGroup = groups.find(group => group.workspaceId === currentStoreId);
  for (const group of groups) {
    if (group === currentGroup) continue;
    for (const session of group.sessions) {
      otherSessions.push({
        ...session,
        sourceWorkspaceId: group.workspaceId,
        workspaceName: group.workspaceName,
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
    currentScopeName: currentGroup?.workspaceName ?? null,
    otherSessions,
  };
}
