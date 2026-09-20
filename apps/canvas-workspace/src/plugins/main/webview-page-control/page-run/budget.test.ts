import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBudget } from './budget';
import { PageRunStop } from './types';
afterEach(() => { vi.useRealTimers(); });

describe('browser task deadlines', () => {
  it('reports the input deadline separately from the overall task budget', async () => {
    vi.useFakeTimers();
    const task = createBudget(180_000);
    const action = createBudget(5_000, task.signal, new PageRunStop('error', 'Browser input timed out.', 'action_timeout'));
    await vi.advanceTimersByTimeAsync(5_001);
    expect(task.signal.aborted).toBe(false);
    expect(action.signal.reason).toMatchObject({ status: 'error', code: 'action_timeout' });
    action.dispose(); task.dispose();
  });

  it('preserves an earlier parent deadline instead of misreporting an input timeout', async () => {
    vi.useFakeTimers();
    const task = createBudget(1_000);
    const action = createBudget(5_000, task.signal, new PageRunStop('error', 'Browser input timed out.', 'action_timeout'));
    await vi.advanceTimersByTimeAsync(1_001);
    expect(action.signal.reason).toMatchObject({ status: 'budget_exhausted' });
    action.dispose(); task.dispose();
  });
});
