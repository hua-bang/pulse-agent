import type {
  ChatDeliveryReceipt,
  ChatPromptSubmission,
  ChatTarget,
  ChatTargetBroker,
} from '../../../modules/chat';
import type { AgentScope } from '../../../types';
import { scopeSessionStoreId } from '../../../../../shared/agent-chat';

const RETRY_MS = 100;

/** The full-page chat for a scope, on whichever session it shows now. */
export const createChatPageTarget = (scope: AgentScope, label: string): ChatTarget => {
  const scopeId = scopeSessionStoreId(scope);
  return {
    surface: 'page',
    scope,
    scopeId,
    sessionId: null,
    composerId: `page:${scopeId}`,
    contextSnapshot: { label },
    executionPolicy: 'auto',
  };
};

/**
 * Submits the prompt once the target's composer is the active chat target.
 * The chat page mounts lazily and registers only after its conversation is
 * ready, so this retries until `timeoutMs` passes.
 */
export const deliverWhenReady = async (
  broker: ChatTargetBroker,
  target: ChatTarget,
  prompt: ChatPromptSubmission,
  timeoutMs = 5000,
): Promise<ChatDeliveryReceipt> => {
  const deadline = Date.now() + timeoutMs;
  let last: ChatDeliveryReceipt = { status: 'unavailable', target: null };
  while (Date.now() < deadline) {
    if (broker.getActiveTarget()?.composerId === target.composerId) {
      last = await broker.deliver({ kind: 'prompt', prompt });
      if (last.status === 'delivered' || last.status === 'queued') return last;
    }
    await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
  }
  return last;
};
