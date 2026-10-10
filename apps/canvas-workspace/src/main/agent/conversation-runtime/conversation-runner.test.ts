import { describe, expect, it, vi } from 'vitest';
import type { CanvasAgent } from '../canvas-agent';
import { ClarificationRegistry } from '../run/clarification-registry';
import { createConversationRunner } from './conversation-runner';
import { ConversationRuntime } from './conversation-runtime';

function setup() {
  const engineWaits = new ClarificationRegistry();
  const trace: string[] = [];
  // Preserve CanvasAgent.chat's real notification-only contract: the engine
  // waits in its own registry, not on the callback's returned promise.
  const agent = {
    chat: vi.fn<Parameters<CanvasAgent['chat']>, ReturnType<CanvasAgent['chat']>>(async (
      message, _text, _call, _result, _workspaces, notify,
      _context, _attachments, _start, _delta, _end, _roleStart, _roleEnd, signal,
    ) => {
      const answer = await engineWaits.wait(
        { id: message, question: 'Which option?', timeout: 0 },
        request => { trace.push(`asked:${request.id}`); notify?.(request); },
        signal,
      );
      trace.push(`engine-resumed:${answer}`);
      return { response: `answer:${answer}`, stopped: signal?.aborted };
    }),
    answerClarification: vi.fn((id: string, answer: string) => engineWaits.answer(id, answer)),
  };
  const runtime = new ConversationRuntime({
    key: { storeId: 'ws-a', sessionId: 'session-a' },
    loadMessages: async () => [],
    persist: async () => undefined,
    runTurn: createConversationRunner(agent as unknown as CanvasAgent),
  });
  return { runtime, engineWaits, agent, trace };
}

describe('conversation runner clarification round-trip', () => {
  it('resumes the engine wait after the conversation accepts the user reply', async () => {
    const { runtime, engineWaits, agent, trace } = setup();
    await runtime.open();
    const turn = runtime.sendAndWait({ message: 'ask-1' });
    try {
      await vi.waitFor(() => expect(runtime.getPendingClarification()?.id).toBe('ask-1'));
      expect(runtime.answerClarification('ask-1', '中文 answer')).toBe(true);
      expect(runtime.getPendingClarification()).toBeNull();
      await vi.waitFor(() => expect(trace).toContain('engine-resumed:中文 answer'), { timeout: 200 });
      expect(agent.answerClarification).toHaveBeenCalledWith('ask-1', '中文 answer');
      await expect(turn).resolves.toMatchObject({ response: 'answer:中文 answer' });
      expect(engineWaits.latest()).toBeNull();
      expect(runtime.getSnapshot().status).toBe('idle');
    } finally {
      runtime.abort();
      await turn;
    }
  });

  it('registers the wait before delivering an external question notification', async () => {
    const { runtime, trace } = setup();
    await runtime.open();
    let matched: boolean | undefined;
    const turn = runtime.sendAndWait({ message: 'ask-fast' }, {
      onClarificationRequest: request => {
        matched = runtime.answerClarification(request.id, 'instant');
      },
    });
    try {
      await vi.waitFor(() => expect(matched).toBe(true), { timeout: 200 });
      await vi.waitFor(() => expect(trace).toContain('engine-resumed:instant'), { timeout: 200 });
      await expect(turn).resolves.toMatchObject({ response: 'answer:instant' });
    } finally {
      runtime.abort();
      await turn;
    }
  });

  it('cancels both waits and rejects late replies after stop', async () => {
    const { runtime, engineWaits } = setup();
    await runtime.open();
    const turn = runtime.sendAndWait({ message: 'ask-stop' });
    await vi.waitFor(() => expect(runtime.getPendingClarification()?.id).toBe('ask-stop'));
    runtime.abort();
    await turn;
    expect(runtime.answerClarification('ask-stop', 'late')).toBe(false);
    expect(engineWaits.latest()).toBeNull();
  });
});

describe('conversation runner failed turns', () => {
  it('persists the failed reply with its tools and recovery metadata', async () => {
    const persisted: unknown[][] = [];
    const agent = {
      chat: vi.fn(async (...args: unknown[]) => {
        const appendRunMessages = args[16] as (sessionId: string, messages: unknown[]) => void;
        appendRunMessages('session-a', [
          { role: 'user', content: 'run it', timestamp: 1 },
          {
            role: 'assistant',
            content: '',
            timestamp: 2,
            toolCalls: [{ id: 1, name: 'bash', toolCallId: 'call-1', status: 'succeeded', result: 'ok' }],
            turnStatus: 'failed',
            failureKind: 'network',
            errorDetails: 'socket hang up',
            retryable: true,
          },
        ]);
        throw new Error('socket hang up');
      }),
      answerClarification: vi.fn(),
    };
    const runtime = new ConversationRuntime({
      key: { storeId: 'ws-a', sessionId: 'session-a' },
      loadMessages: async () => [],
      persist: async (messages) => { persisted.push(messages); },
      runTurn: createConversationRunner(agent as unknown as CanvasAgent),
      checkpointMs: 0,
    });
    await runtime.open();

    await expect(runtime.sendAndWait({ message: 'run it' })).resolves.toMatchObject({ error: 'socket hang up' });

    expect(persisted.at(-1)).toMatchObject([
      { role: 'user', content: 'run it' },
      {
        role: 'assistant',
        turnStatus: 'failed',
        failureKind: 'network',
        retryable: true,
        toolCalls: [{ name: 'bash', status: 'succeeded', result: 'ok' }],
      },
    ]);
  });
});
