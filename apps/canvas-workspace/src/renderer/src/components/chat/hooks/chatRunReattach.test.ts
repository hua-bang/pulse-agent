// @vitest-environment happy-dom
import type { Dispatch, SetStateAction } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AgentChatMessage } from '../../../types';
import type { PendingClarification, ToolCallStatus } from '../types';
import { subscribeReattachedRun } from './chatRunReattach';

const setter = <T>(read: () => T, write: (value: T) => void): Dispatch<SetStateAction<T>> => (
  update => write(typeof update === 'function' ? (update as (value: T) => T)(read()) : update)
);

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (window as unknown as { canvasWorkspace?: unknown }).canvasWorkspace;
});

describe('subscribeReattachedRun', () => {
  it('replays deltas emitted while the conversation was off-screen and settles from history', async () => {
    vi.useFakeTimers();
    let messages: AgentChatMessage[] = [
      { role: 'user', content: 'Question', timestamp: 1 },
    ];
    let streamingTools: ToolCallStatus[] = [];
    let messageTools = new Map<number, ToolCallStatus[]>();
    let collapsedSections = new Set<number>();
    let pendingClarify: PendingClarification | null = null;
    let clarifyInput = '';
    let clarificationAnswering = false;
    let clarificationError: string | null = null;
    let loading = true;
    const onRunSettled = vi.fn();
    const getRunStatus = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        active: true,
        replay: {
          active: true,
          cursor: 1,
          events: [{ sequence: 1, channel: 'text-delta', data: 'Missed while away' }],
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        active: false,
        replay: {
          active: false,
          cursor: 2,
          events: [{ sequence: 2, channel: 'chat-complete', data: { ok: true } }],
        },
      });
    (window as unknown as { canvasWorkspace: unknown }).canvasWorkspace = {
      agent: { getRunStatus },
    };

    const cleanup = subscribeReattachedRun({
      sessionId: 'run-background',
      isLive: () => true,
      setMessages: setter(() => messages, value => { messages = value; }),
      setStreamingTools: setter(() => streamingTools, value => { streamingTools = value; }),
      setMessageTools: setter(() => messageTools, value => { messageTools = value; }),
      setCollapsedSections: setter(() => collapsedSections, value => { collapsedSections = value; }),
      setPendingClarify: setter(() => pendingClarify, value => { pendingClarify = value; }),
      setClarifyInput: setter(() => clarifyInput, value => { clarifyInput = value; }),
      setClarificationAnswering: setter(
        () => clarificationAnswering,
        value => { clarificationAnswering = value; },
      ),
      setClarificationError: setter(
        () => clarificationError,
        value => { clarificationError = value; },
      ),
      setLoading: setter(() => loading, value => { loading = value; }),
      streamingMsgIdx: { current: -1 },
      toolIdCounter: { current: 0 },
      onRunSettled,
    });

    await vi.runAllTimersAsync();

    expect(getRunStatus).toHaveBeenNthCalledWith(1, 'run-background', 0);
    expect(getRunStatus).toHaveBeenNthCalledWith(2, 'run-background', 1);
    expect(messages.map(message => message.content)).toEqual([
      'Question',
      'Missed while away',
    ]);
    expect(loading).toBe(false);
    expect(onRunSettled).toHaveBeenCalledOnce();

    cleanup.forEach(unsubscribe => unsubscribe());
  });
});
