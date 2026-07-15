import { describe, expect, it } from 'vitest';
import { selectWebviewsToDiscard, type DiscardCandidate } from '../discard-policy';

const candidate = (key: string, rssMB: number, frozenSinceMs?: number): DiscardCandidate =>
  ({ key, rssMB, frozenSinceMs });

describe('selectWebviewsToDiscard', () => {
  it('selects nothing while under budget', () => {
    const out = selectWebviewsToDiscard(
      [candidate('a', 400, 1000), candidate('b', 500)],
      1500,
    );
    expect(out).toEqual([]);
  });

  it('discards oldest-frozen-first until the projection is under budget', () => {
    const out = selectWebviewsToDiscard(
      [
        candidate('newest-frozen', 300, 3000),
        candidate('active', 900),
        candidate('oldest-frozen', 300, 1000),
        candidate('mid-frozen', 300, 2000),
      ],
      1200,
    );
    // total 1800 → drop oldest (1500) → still over → drop mid (1200 ≤ budget)
    expect(out).toEqual(['oldest-frozen', 'mid-frozen']);
  });

  it('never selects an unfrozen page, even when that leaves the total over budget', () => {
    const out = selectWebviewsToDiscard(
      [candidate('active-huge', 2000), candidate('frozen', 100, 1000)],
      1500,
    );
    expect(out).toEqual(['frozen']);
  });

  it('stops as soon as the projection reaches the budget', () => {
    const out = selectWebviewsToDiscard(
      [candidate('f1', 600, 1), candidate('f2', 600, 2), candidate('f3', 600, 3)],
      1200,
    );
    expect(out).toEqual(['f1']);
  });
});
