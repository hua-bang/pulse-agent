import { describe, expect, it, vi } from 'vitest';
import { createChatTurnEpochGuard } from './chatTurnEpoch';

describe('createChatTurnEpochGuard', () => {
  it('drops continuations after the chat scope epoch changes', () => {
    const ref = { current: 4 };
    const callback = vi.fn();
    const turn = createChatTurnEpochGuard(ref, 4);

    turn.guard(callback)('before');
    ref.current += 1;
    turn.guard(callback)('after');

    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith('before');
    expect(turn.isCurrent()).toBe(false);
  });
});
