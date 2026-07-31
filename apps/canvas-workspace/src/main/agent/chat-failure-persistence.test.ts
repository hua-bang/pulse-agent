import { describe, expect, it, vi } from 'vitest';
import {
  createFailedTurnToolTracker,
  failedAssistantMessage,
} from './chat-failure-persistence';

describe('failedAssistantMessage', () => {
  it('creates a durable retryable failure frame without provider prose', () => {
    vi.spyOn(Date, 'now').mockReturnValue(123);

    expect(failedAssistantMessage(new Error('network timeout'))).toMatchObject({
      role: 'assistant',
      content: '',
      timestamp: 123,
      turnStatus: 'failed',
      failureKind: 'network',
      retryable: true,
      errorDetails: expect.stringContaining('network timeout'),
    });
  });

  it('keeps authentication failures non-retryable', () => {
    expect(failedAssistantMessage('401 unauthorized')).toMatchObject({
      turnStatus: 'failed',
      failureKind: 'auth',
      retryable: false,
    });
  });

  it('persists and settles the live tool snapshot when a turn fails', () => {
    const forwarded = vi.fn();
    const tracker = createFailedTurnToolTracker({ onToolCall: forwarded });
    tracker.callbacks.onToolInputStart?.({ id: 'tool-1', toolName: 'canvas_read_node' });
    tracker.callbacks.onToolInputDelta?.({ id: 'tool-1', delta: '{"id":' });
    tracker.callbacks.onToolCall?.({
      name: 'canvas_read_node',
      args: { id: 'node-1' },
      toolCallId: 'tool-1',
    });

    const message = failedAssistantMessage(
      new Error('provider disconnected'),
      tracker.snapshot(),
    );

    expect(forwarded).toHaveBeenCalledOnce();
    expect(message.toolCalls).toEqual([expect.objectContaining({
      name: 'canvas_read_node',
      toolCallId: 'tool-1',
      args: { id: 'node-1' },
      partialInput: '{"id":',
      inputStreaming: false,
      status: 'failed',
      error: expect.stringContaining('provider disconnected'),
    })]);
  });
});
