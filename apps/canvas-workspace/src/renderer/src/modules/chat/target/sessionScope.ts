import {
  GLOBAL_CHAT_STORE_ID,
  scheduledTaskIdFromStoreId,
  scopeSessionStoreId,
} from '../../../../../shared/agent-chat';
import type { AgentScope } from '../../../types';
import type { ChatTarget } from './index';

/** Maps the session rail's storage identity back to the owning agent scope. */
export const scopeFromSessionStoreId = (storeId: string): AgentScope => {
  if (storeId === GLOBAL_CHAT_STORE_ID) return { kind: 'global' };
  const taskId = scheduledTaskIdFromStoreId(storeId);
  return taskId
    ? { kind: 'scheduled', taskId }
    : { kind: 'workspace', workspaceId: storeId };
};

export const createChatPageSessionTarget = (
  scope: AgentScope,
  sessionId: string,
  scopeLabel: string,
): ChatTarget => {
  const scopeId = scopeSessionStoreId(scope);
  return {
    surface: 'page',
    scope,
    scopeId,
    sessionId,
    composerId: `page:${scopeId}`,
    contextSnapshot: { label: scopeLabel },
    executionPolicy: scope.kind === 'scheduled' ? 'scheduled' : 'auto',
  };
};
