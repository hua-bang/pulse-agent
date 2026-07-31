import type { AgentChatMessage } from '../../../types';
import type { AgentScope } from '../types';

export async function recoverChangedChatSession(opts: {
  scope: AgentScope;
  error: unknown;
  isCurrent: () => boolean;
  replaceMessages: (messages: AgentChatMessage[]) => void;
  adoptSession?: (sessionId: string) => void;
  appendFailure: (error: unknown) => void;
  reset: () => void;
}): Promise<void> {
  try {
    const history = await window.canvasWorkspace.agent.getHistory({ scope: opts.scope });
    if (!opts.isCurrent()) return;
    if (history.ok && history.messages) opts.replaceMessages(history.messages);
    if (history.ok && history.activeSessionId) opts.adoptSession?.(history.activeSessionId);
    opts.appendFailure(opts.error);
  } catch (error) {
    if (!opts.isCurrent()) return;
    opts.appendFailure(error);
  }
  opts.reset();
}
