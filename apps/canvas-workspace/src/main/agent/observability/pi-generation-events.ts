import type { AgentMessage } from '@earendil-works/pi-agent-core';

import { publishAgentTraceEvent } from '../../../plugins/main';

export interface PiGenerationObserver {
  onEvent(event: { type: string; message?: AgentMessage }): void;
}

export const createPiGenerationObserver = (
  runId: string | undefined,
): PiGenerationObserver => {
  let generationCounter = 0;
  let activeGenerationId: string | undefined;

  return {
    onEvent(event) {
      if (!runId) return;

      if (event.type === 'message_start' && event.message?.role === 'assistant') {
        activeGenerationId = `${runId}:generation:${++generationCounter}`;
        publishAgentTraceEvent({
          type: 'generation.started',
          runId,
          timestamp: Date.now(),
          generationId: activeGenerationId,
          owner: 'pi',
          model: event.message.model,
        });
      }

      if (
        event.type === 'message_end'
        && event.message?.role === 'assistant'
        && activeGenerationId
      ) {
        const generationId = activeGenerationId;
        activeGenerationId = undefined;
        publishAgentTraceEvent({
          type: 'generation.completed',
          runId,
          timestamp: Date.now(),
          generationId,
          owner: 'pi',
          finishReason: event.message.stopReason,
          error: event.message.stopReason === 'error'
            ? event.message.errorMessage
            : undefined,
        });
      }
    },
  };
};
