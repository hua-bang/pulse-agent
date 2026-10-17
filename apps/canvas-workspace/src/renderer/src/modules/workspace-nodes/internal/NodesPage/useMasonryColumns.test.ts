import { describe, expect, it } from 'vitest';
import { distributeIntoColumns, masonryColumnCount } from './useMasonryColumns';

describe('Knowledge list masonry', () => {
  it('fits as many 260px columns as the width allows, at least one', () => {
    expect(masonryColumnCount(0)).toBe(1);
    expect(masonryColumnCount(531)).toBe(1);
    expect(masonryColumnCount(532)).toBe(2);
    expect(masonryColumnCount(1156)).toBe(4);
  });

  it('deals cards across columns so the first row fills before the second', () => {
    expect(distributeIntoColumns([1, 2, 3, 4, 5, 6], 4)).toEqual([[1, 5], [2, 6], [3], [4]]);
    expect(distributeIntoColumns([1, 2], 3)).toEqual([[1], [2], []]);
  });
});
