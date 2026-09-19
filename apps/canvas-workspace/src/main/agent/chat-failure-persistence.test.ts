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


describe('ordered turn persistence', () => {
  it('preserves parallel calls and intervening prose on failure and reload', () => {
    const tracker = createFailedTurnToolTracker();
    tracker.callbacks.onText?.('Inspect');
    tracker.callbacks.onToolCall?.({ name: 'read', args: {}, toolCallId: 'a' });
    tracker.callbacks.onToolCall?.({ name: 'read', args: {}, toolCallId: 'b' });
    tracker.callbacks.onText?.('Verify');
    const message = failedAssistantMessage(
      new Error('network timeout'), tracker.snapshot(), tracker.contentBlocks(),
    );
    const reloaded = JSON.parse(JSON.stringify(message));
    expect(reloaded.content).toBe('InspectVerify');
    expect(reloaded.contentBlocks).toEqual([
      { type: 'text', text: 'Inspect' },
      { type: 'tool', toolId: 1, toolCallId: 'a' },
      { type: 'tool', toolId: 2, toolCallId: 'b' },
      { type: 'text', text: 'Verify' },
    ]);
    expect(reloaded.toolCalls.map((tool: { status: string }) => tool.status))
      .toEqual(['failed', 'failed']);
  });

  it('keeps event IDs when final tool snapshots arrive in reverse order', () => {
    const tracker = createFailedTurnToolTracker();
    tracker.callbacks.onText?.('Inspect');
    tracker.callbacks.onToolCall?.({ name: 'read', args: {}, toolCallId: 'a' });
    tracker.callbacks.onToolCall?.({ name: 'read', args: {}, toolCallId: 'b' });
    tracker.callbacks.onText?.('Done');
    const final = tracker.finalize('Done', [
      { id: 1, toolCallId: 'b', name: 'read', status: 'succeeded' },
      { id: 2, toolCallId: 'a', name: 'read', status: 'succeeded' },
    ]);
    expect(final.content).toBe('InspectDone');
    expect(final.toolCalls).toMatchObject([
      { id: 1, toolCallId: 'a', status: 'succeeded' },
      { id: 2, toolCallId: 'b', status: 'succeeded' },
    ]);
  });
});
