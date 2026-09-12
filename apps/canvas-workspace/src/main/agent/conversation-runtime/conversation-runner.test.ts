import { describe, expect, it, vi } from 'vitest';
import type { CanvasAgent } from '../canvas-agent';
import { ClarificationRegistry } from '../clarification-registry';
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
