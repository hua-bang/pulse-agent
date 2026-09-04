import { describe, expect, it } from 'vitest';
import {
  buildSearchRegex,
  DEFAULT_SEARCH_OPTIONS,
  findTextMatches,
  type NoteSearchOptions,
} from './noteSearchMatching';

const opts = (o: Partial<NoteSearchOptions> = {}): NoteSearchOptions => ({
  ...DEFAULT_SEARCH_OPTIONS,
  ...o,
});

describe('noteSearchMatching', () => {
  it('returns no matches for an empty query', () => {
    expect(findTextMatches('hello world', '', opts())).toEqual([]);
    expect(buildSearchRegex('', opts())).toBeNull();
  });

  it('matches case-insensitively by default', () => {
    const m = findTextMatches('Cat cat CAT', 'cat', opts());
    expect(m.map((x) => x.index)).toEqual([0, 4, 8]);
    expect(m.every((x) => x.length === 3)).toBe(true);
  });

  it('respects the caseSensitive option', () => {
    const m = findTextMatches('Cat cat CAT', 'cat', opts({ caseSensitive: true }));
    expect(m.map((x) => x.index)).toEqual([4]);
  });

  it('respects the wholeWord option', () => {
    const m = findTextMatches('cat category scatter cat', 'cat', opts({ wholeWord: true }));
    expect(m.map((x) => x.index)).toEqual([0, 21]);
  });

  it('escapes regex metacharacters in literal mode', () => {
    expect(findTextMatches('abc', 'a.c', opts())).toEqual([]);
    expect(findTextMatches('a.c', 'a.c', opts()).map((x) => x.index)).toEqual([0]);
  });

  it('treats the query as a pattern in regex mode', () => {
    const m = findTextMatches('a1 b2 c3', '[a-z]\\d', opts({ regex: true }));
    expect(m.map((x) => x.index)).toEqual([0, 3, 6]);
  });

  it('returns null / no matches for an invalid regex', () => {
    expect(buildSearchRegex('(', opts({ regex: true }))).toBeNull();
    expect(findTextMatches('whatever', '(', opts({ regex: true }))).toEqual([]);
  });

  it('terminates and drops zero-width matches (e.g. a*)', () => {
    const m = findTextMatches('xaaax', 'a*', opts({ regex: true }));
    expect(m).toEqual([{ index: 1, length: 3 }]);
  });
});
