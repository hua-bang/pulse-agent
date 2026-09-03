import type { AgentScope } from '../../types';
import type { ConversationKey } from '../../../../shared/conversation-runtime';

export const conversationKeyFromScope = (
  scope: AgentScope,
  sessionId: string,
): ConversationKey => ({
  storeId: scope.kind === 'workspace'
    ? scope.workspaceId
    : scope.kind === 'scheduled'
      ? `__scheduled__-${scope.taskId}`
      : '__global_chat__',
  sessionId,
});
