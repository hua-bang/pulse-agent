import { useLayoutEffect, useRef } from 'react';
import type { AgentChatMessage } from '../../../types';
import { markAgentMilestone } from './markAgentMilestone';

/** Measure committed text, not IPC receipt or an uncommitted store update. */
export function useChatRenderTiming(message: AgentChatMessage, streaming: boolean): void {
  const activeRun = useRef<string>();
  const renderedRun = useRef<string>();
  useLayoutEffect(() => {
    if (message.role !== 'assistant' || !message.runId) return;
    if (streaming) activeRun.current = message.runId;
    if (activeRun.current !== message.runId) return;
    if (message.content && renderedRun.current !== message.runId) {
      renderedRun.current = message.runId;
      markAgentMilestone(message.runId, 'ui.first-content-rendered');
    }
    if (!streaming) {
      markAgentMilestone(message.runId, 'ui.response-completed');
      activeRun.current = undefined;
    }
  }, [message.role, message.runId, message.content, streaming]);
}
