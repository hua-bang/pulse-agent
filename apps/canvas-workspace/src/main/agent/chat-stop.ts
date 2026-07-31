import type { CanvasAgentMessage, CanvasAgentToolCall } from './types';

export const ENGINE_ABORT_SENTINEL = 'Request aborted.';

export function createStoppedBeforeSegmentOutcome(timestamp = Date.now()): {
  response: { response: ''; stopped: true };
  message: CanvasAgentMessage;
} {
  return {
    response: { response: '', stopped: true },
    message: {
      role: 'assistant',
      content: '',
      timestamp,
      turnStatus: 'stopped',
      retryable: true,
    },
  };
}

export function persistStoppedBeforeSegment(
  store: { addMessage: (message: CanvasAgentMessage) => void },
  timestamp = Date.now(),
): { response: ''; stopped: true } {
  const outcome = createStoppedBeforeSegmentOutcome(timestamp);
  store.addMessage(outcome.message);
  return outcome.response;
}

export function linkRunAbortSignal(
  signal: AbortSignal | undefined,
  controller: AbortController,
): () => void {
  const forward = () => controller.abort();
  if (signal?.aborted) forward();
  else signal?.addEventListener('abort', forward, { once: true });
  return () => signal?.removeEventListener('abort', forward);
}

/**
 * The engine reports an intentional abort as ordinary text. Convert it back
 * into lifecycle state and retain only deltas that were actually shown.
 */
export function resolveSegmentOutcome(input: {
  signalAborted: boolean;
  resultText: string;
  streamedText: string;
}): { stopped: boolean; rawText: string } {
  const stopped = (
    input.signalAborted
    || input.resultText === ENGINE_ABORT_SENTINEL
  );
  return {
    stopped,
    rawText: stopped
      ? input.streamedText
      : input.resultText || '(no response)',
  };
}

export function settleStoppedToolCalls(
  toolCalls: CanvasAgentToolCall[],
  streamedToolCalls: CanvasAgentToolCall[] = [],
): void {
  for (const streamed of streamedToolCalls) {
    const exists = toolCalls.some(tool => (
      streamed.toolCallId
        ? tool.toolCallId === streamed.toolCallId
        : tool.name === streamed.name
    ));
    if (!exists) toolCalls.push({ ...streamed });
  }
  for (const tool of toolCalls) {
    if (tool.status !== 'queued' && tool.status !== 'running') continue;
    tool.status = 'cancelled';
    tool.error = tool.error ?? 'Operation cancelled by user';
  }
}
