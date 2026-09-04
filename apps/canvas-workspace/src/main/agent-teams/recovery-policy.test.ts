import { describe, expect, it } from 'vitest';
import { isRecoverableSessionExitReview, observeQueuedLaunch } from './recovery-policy';

describe('agent team recovery policy', () => {
  it('starts, waits within, and expires at the queued-launch grace boundary', () => {
    expect(observeQueuedLaunch(undefined, 100, 50)).toEqual({ state: 'started', since: 100 });
    expect(observeQueuedLaunch(100, 149, 50)).toEqual({ state: 'waiting', since: 100 });
    expect(observeQueuedLaunch(100, 150, 50)).toEqual({ state: 'expired' });
  });

  it('recognizes only matching session-exit reviews owned by the agent', () => {
    const task = {
      status: 'needs_review',
      ownerAgentId: 'agent-1',
      blockedReason: 'Agent session exited with code 1 before reporting task completion.',
    };
    expect(isRecoverableSessionExitReview(task as never, 'agent-1')).toBe(true);
    expect(isRecoverableSessionExitReview(task as never, 'agent-2')).toBe(false);
    expect(isRecoverableSessionExitReview({ ...task, status: 'done' } as never, 'agent-1')).toBe(false);
  });
});
