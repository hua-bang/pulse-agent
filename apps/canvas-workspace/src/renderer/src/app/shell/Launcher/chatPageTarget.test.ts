import { afterEach, describe, expect, it, vi } from 'vitest';
import { createChatTargetBroker, type ChatTarget } from '../../../modules/chat';
import { createChatPageSessionTarget } from '../../../modules/chat/session';
import { deliverWhenReady } from './chatPageTarget';

afterEach(() => { vi.useRealTimers(); });

describe('launcher delivery readiness', () => {
  it('waits for the requested conversation, without sending to the previous session', async () => {
    vi.useFakeTimers();
    const broker = createChatTargetBroker();
    const target = createChatPageSessionTarget({ kind: 'global' }, 'fresh', 'General');
    const oldSubmit = vi.fn().mockResolvedValue(true);
    const newSubmit = vi.fn().mockResolvedValue(true);
    broker.register({ ...target, sessionId: 'previous' } as ChatTarget, { submitPrompt: oldSubmit });
    const pending = deliverWhenReady(broker, target, { text: 'fresh question', nodes: [] });
    await vi.advanceTimersByTimeAsync(100);
    expect(oldSubmit).not.toHaveBeenCalled();
    broker.register(target, { submitPrompt: newSubmit });
    await vi.advanceTimersByTimeAsync(100);
    expect((await pending).status).toBe('delivered');
    expect(newSubmit).toHaveBeenCalledTimes(1);
  });
});
