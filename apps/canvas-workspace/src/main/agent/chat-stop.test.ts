import { describe, expect, it } from 'vitest';

import {
  createStoppedBeforeSegmentOutcome,
  ENGINE_ABORT_SENTINEL,
  linkRunAbortSignal,
  persistStoppedBeforeSegment,
  resolveSegmentOutcome,
  settleStoppedToolCalls,
} from './chat-stop';
import type { CanvasAgentToolCall } from './types';

describe('chat stop normalization', () => {
  it('creates an empty stopped turn before any segment starts', () => {
    const outcome = createStoppedBeforeSegmentOutcome(123);
    const messages: unknown[] = [];
    const response = persistStoppedBeforeSegment({ addMessage: message => messages.push(message) }, 123);

    expect(outcome.response).toEqual({ response: '', stopped: true });
    expect(outcome.message).toEqual({
      role: 'assistant',
      content: '',
      timestamp: 123,
      turnStatus: 'stopped',
      retryable: true,
    });
    expect(response).toEqual(outcome.response);
    expect(messages).toEqual([outcome.message]);
    expect(outcome.message.content).not.toContain('Request aborted');
  });

  it('links a signal that was already aborted and can detach a live signal', () => {
    const early = new AbortController();
    const target = new AbortController();
    early.abort();
    linkRunAbortSignal(early.signal, target);
    expect(target.signal.aborted).toBe(true);

    const live = new AbortController();
    const detachedTarget = new AbortController();
    const detach = linkRunAbortSignal(live.signal, detachedTarget);
    detach();
    live.abort();
    expect(detachedTarget.signal.aborted).toBe(false);
  });

  it('preserves streamed partial text and never exposes the engine abort sentinel', () => {
    const outcome = resolveSegmentOutcome({
      signalAborted: true,
      resultText: ENGINE_ABORT_SENTINEL,
      streamedText: 'A useful partial answer',
    });

    expect(outcome).toEqual({
      stopped: true,
      rawText: 'A useful partial answer',
    });
    expect(outcome.rawText).not.toContain('Request aborted');
  });

  it('marks only unfinished tools as cancelled', () => {
    const tools = [
      { id: 1, name: 'read', status: 'succeeded' as const },
      { id: 2, name: 'bash', status: 'running' as const },
      { id: 3, name: 'write', status: 'queued' as const },
    ];

    settleStoppedToolCalls(tools);

    expect(tools).toEqual([
      { id: 1, name: 'read', status: 'succeeded' },
      {
        id: 2,
        name: 'bash',
        status: 'cancelled',
        error: 'Operation cancelled by user',
      },
      {
        id: 3,
        name: 'write',
        status: 'cancelled',
        error: 'Operation cancelled by user',
      },
    ]);
  });

  it('retains a streamed external tool when abort prevents a driver result', () => {
    const persisted: CanvasAgentToolCall[] = [];

    settleStoppedToolCalls(persisted, [{
      id: 1,
      name: 'external_exec',
      toolCallId: 'external-1',
      status: 'running',
      args: { command: 'long-task' },
    }]);

    expect(persisted).toEqual([expect.objectContaining({
      name: 'external_exec',
      toolCallId: 'external-1',
      status: 'cancelled',
      error: 'Operation cancelled by user',
    })]);
  });
});
